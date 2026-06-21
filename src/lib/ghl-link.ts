import { clientEnv } from "./env";

// ===========================================================================
// Link directo a la conversación de un contacto en GoHighLevel.
//
// El panel muestra "Ver conversación" en Aprobaciones, Derivaciones y
// Certificados. Por ahora ese botón lleva a la conversación REAL en GHL (no al
// visor interno del panel), así el equipo responde desde la herramienta donde
// vive el chat de WhatsApp.
//
// La URL se arma con el locationId de la subcuenta (env) + el contactId, que
// guardamos como `external_id` de la conversación (solo las conversaciones de
// WhatsApp tienen uno). Si falta cualquiera de los dos, devolvemos null y el
// llamador cae al visor interno.
// ===========================================================================

const GHL_APP_BASE = "https://app.gohighlevel.com/v2/location";

export interface GhlLinkConversation {
  source: string;
  externalId: string | null;
}

/**
 * URL a la conversación del contacto en GHL, o null si no se puede armar
 * (no es WhatsApp, falta el external_id, o no está seteado el locationId).
 */
export function ghlConversationUrl(conv: GhlLinkConversation | null): string | null {
  if (!conv) return null;
  if (conv.source !== "whatsapp") return null;
  const contactId = conv.externalId?.trim();
  if (!contactId) return null;
  const locationId = clientEnv.NEXT_PUBLIC_GHL_LOCATION_ID;
  if (!locationId) return null;
  return `${GHL_APP_BASE}/${locationId}/conversations/conversations/${contactId}`;
}
