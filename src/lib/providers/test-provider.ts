import "server-only";

import type { IncomingMessage, MessagingProvider } from "./index";

// ===========================================================================
// testProvider — implementacion de fase 1 (el panel).
//
// El panel no tiene un "canal externo": la respuesta del agente se persiste
// en la tabla `messages` (lo hace el worker) y Supabase Realtime la propaga
// al frontend. Por eso `sendMessage` aca es un no-op.
//
// Cuando llegue WhatsApp (fase 2) se crea `whatsapp-provider.ts` con la misma
// interfaz y un `sendMessage` que hace POST al Graph API de Meta.
// ===========================================================================

let incomingHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

export const testProvider: MessagingProvider = {
  name: "test",

  onIncomingMessage(handler) {
    incomingHandler = handler;
  },

  async sendMessage(to, content) {
    // No-op: en el panel la entrega la hace Supabase Realtime sobre la tabla
    // `messages`. Se deja un log para debugging en desarrollo.
    console.debug(`[test-provider] sendMessage(${to}): ${content.slice(0, 80)}`);
  },
};

/** Entrega un mensaje entrante al handler registrado (uso interno/fase 2). */
export async function deliverIncoming(msg: IncomingMessage): Promise<void> {
  if (incomingHandler) await incomingHandler(msg);
}
