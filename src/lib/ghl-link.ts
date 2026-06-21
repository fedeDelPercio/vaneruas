import { clientEnv } from "./env";

// ===========================================================================
// Link a la conversación de un contacto en GoHighLevel.
//
// El panel muestra "Ver conversación" en Aprobaciones, Derivaciones y
// Certificados. Ese botón lleva a la conversación REAL en GHL (no al visor
// interno del panel), así el equipo responde desde la herramienta donde vive
// el chat de WhatsApp.
//
// NO armamos la URL de GHL directo: GHL identifica el thread por SU
// `conversationId` (no por el contactId que tenemos en `external_id`). Por eso
// apuntamos a un endpoint propio (`/api/ghl/conversation`) que resuelve el
// conversationId de GHL en vivo y redirige al thread exacto. Si no es una
// conversación de WhatsApp, falta el contacto, o no está seteado el locationId,
// devolvemos null y el llamador cae al visor interno.
// ===========================================================================

export interface GhlLinkConversation {
  id: string;
  source: string;
  externalId: string | null;
}

/**
 * URL al endpoint que redirige al thread exacto del contacto en GHL, o null si
 * no aplica (no es WhatsApp, falta el external_id, o no está configurado el
 * locationId).
 */
export function ghlConversationUrl(conv: GhlLinkConversation | null): string | null {
  if (!conv) return null;
  if (conv.source !== "whatsapp") return null;
  if (!conv.externalId?.trim()) return null;
  if (!clientEnv.NEXT_PUBLIC_GHL_LOCATION_ID) return null;
  return `/api/ghl/conversation?c=${encodeURIComponent(conv.id)}`;
}
