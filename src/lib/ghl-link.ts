import { clientEnv } from "./env";

// ===========================================================================
// Link a la conversación de un contacto en GoHighLevel.
//
// El panel muestra "Ver conversación" en Aprobaciones, Derivaciones y
// Certificados. Ese botón lleva a la conversación REAL en GHL (no al visor
// interno del panel), así el equipo responde desde la herramienta donde vive
// el chat de WhatsApp.
//
// GHL identifica el thread por SU `conversationId` (no por el contactId que
// tenemos en `external_id`). Lo cacheamos en `ghl_conversation_id` (lo completa
// el inbound: la conversación que acaba de recibir el mensaje es el thread
// correcto). Si lo tenemos, armamos el deep-link DIRECTO al thread exacto. Si
// todavía no (conversaciones viejas), caemos a un endpoint propio que lo
// resuelve en vivo y lo cachea para la próxima. Si no es WhatsApp o falta el
// locationId, devolvemos null y el llamador cae al visor interno.
// ===========================================================================

const GHL_APP_BASE = "https://app.gohighlevel.com/v2/location";
// La bandeja de GHL necesita estos query params para renderizar el thread
// dentro de la vista correcta (sin ellos abre la bandeja pero no selecciona la
// conversación).
const INBOX_QS = "?category=team-inbox&tab=all";

export interface GhlLinkConversation {
  id: string;
  source: string;
  externalId: string | null;
  /** conversationId de GHL (el thread). Si está, se arma el link directo. */
  ghlConversationId?: string | null;
}

/**
 * URL al thread exacto del contacto en GHL, o null si no aplica (no es
 * WhatsApp, no hay forma de identificar el thread, o no está configurado el
 * locationId). Puede ser una URL absoluta de GHL (link directo) o una ruta
 * propia que resuelve y redirige (fallback).
 */
export function ghlConversationUrl(conv: GhlLinkConversation | null): string | null {
  if (!conv) return null;
  if (conv.source !== "whatsapp") return null;
  const loc = clientEnv.NEXT_PUBLIC_GHL_LOCATION_ID;
  if (!loc) return null;

  // Link directo al thread exacto: lo más confiable (no depende de resolver
  // nada en vivo).
  const ghlConvId = conv.ghlConversationId?.trim();
  if (ghlConvId) {
    return `${GHL_APP_BASE}/${loc}/conversations/conversations/${ghlConvId}${INBOX_QS}`;
  }

  // Sin el conversationId cacheado: caemos al endpoint que lo resuelve en vivo
  // (y lo persiste para la próxima). Necesita el contactId.
  if (!conv.externalId?.trim()) return null;
  return `/api/ghl/conversation?c=${encodeURIComponent(conv.id)}`;
}
