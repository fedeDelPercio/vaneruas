import { clientEnv } from "./env";

// ===========================================================================
// Link a la conversación de un contacto en GoHighLevel.
//
// El panel muestra "Ver conversación" en Aprobaciones, Derivaciones y
// Certificados. Ese botón lleva a GHL (no al visor interno del panel), así el
// equipo responde desde la herramienta donde vive el chat de WhatsApp.
//
// IMPORTANTE — por qué apuntamos a la FICHA DEL CONTACTO y no al thread:
// El deep-link directo a una conversación de GHL
// (`/conversations/conversations/{conversationId}`) NO es confiable: el SPA de
// GHL, al abrir esa URL en frío, hace su propio redirect interno y cae en "la
// última" conversación (es una limitación conocida de GHL, hay un feature
// request abierto). En cambio la ficha del contacto
// (`/contacts/detail/{contactId}`) apunta a una ENTIDAD estable: abre siempre a
// esa persona puntual y su conversación queda a la vista. Validado en vivo.
//
// Usa el `contactId` (lo tenemos en `external_id` para todas las conversaciones
// de WhatsApp), así no hay nada que resolver y funciona retroactivo. Si no es
// WhatsApp, falta el contactId, o no está el locationId, devolvemos null y el
// llamador cae al visor interno.
// ===========================================================================

const GHL_APP_BASE = "https://app.gohighlevel.com/v2/location";

export interface GhlLinkConversation {
  id: string;
  source: string;
  externalId: string | null;
}

/**
 * URL a la ficha del contacto en GHL (con su conversación), o null si no aplica
 * (no es WhatsApp, falta el contactId, o no está configurado el locationId).
 */
export function ghlConversationUrl(conv: GhlLinkConversation | null): string | null {
  if (!conv) return null;
  if (conv.source !== "whatsapp") return null;
  const loc = clientEnv.NEXT_PUBLIC_GHL_LOCATION_ID;
  if (!loc) return null;
  const contactId = conv.externalId?.trim();
  if (!contactId) return null;
  return `${GHL_APP_BASE}/${loc}/contacts/detail/${contactId}`;
}
