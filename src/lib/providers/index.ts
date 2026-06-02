// ===========================================================================
// MessagingProvider — abstraccion del canal de mensajeria.
//
// El agente y el worker NO conocen el canal concreto. Hablan contra esta
// interfaz. En fase 1 el unico provider es `test` (el panel). En fase 2 se
// agrega `whatsapp` implementando esta misma interfaz, sin tocar el agente.
//
// Reparto de responsabilidades:
//  - La tabla `messages` es el system of record para TODOS los canales.
//    El worker siempre persiste ahi (incluido WhatsApp en fase 2).
//  - `sendMessage` se ocupa SOLO de la entrega externa del canal:
//      * test     -> no-op (el panel lee la DB via Realtime).
//      * whatsapp -> POST al Graph API de Meta (fase 2).
// ===========================================================================

export type ProviderName = "test" | "whatsapp";

/** Mensaje entrante normalizado (del panel o, en fase 2, de WhatsApp). */
export interface IncomingMessage {
  conversationId: string;
  content: string;
  source: "panel" | "whatsapp";
  /** Numero de telefono u otro id externo. null para mensajes del panel. */
  externalId?: string | null;
}

export interface MessagingProvider {
  readonly name: ProviderName;
  /**
   * Registra el handler de mensajes entrantes. En fase 1 el endpoint
   * /api/webhooks/incoming cumple este rol directamente; el handler queda
   * disponible para fase 2 (webhook de Meta).
   */
  onIncomingMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
  /**
   * Entrega la respuesta del agente por el canal externo.
   * @param to identificador del destino (conversationId en test, phone en whatsapp)
   * @param content texto de la respuesta
   */
  sendMessage(to: string, content: string): Promise<void>;
}
