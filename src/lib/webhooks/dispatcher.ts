import "server-only";

import { createHmac } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

// ===========================================================================
// Dispatcher de webhooks salientes.
//
// Cada vez que ocurre un evento relevante del agente, esta funcion notifica a
// todos los webhooks configurados (tabla outbound_webhooks) que esten activos
// y suscriptos a ese evento. Cada intento de entrega se registra en
// outbound_webhook_deliveries para debugging desde el tab Webhooks.
// ===========================================================================

export type OutboundEvent =
  | "message.received"
  | "agent.responded"
  | "agent.escalated"
  | "agent.failed"
  | "payment.received";

const DELIVERY_TIMEOUT_MS = 5000;

/**
 * Notifica un evento a todos los webhooks salientes suscriptos.
 * No lanza: los errores de entrega quedan registrados en la tabla de
 * deliveries, no interrumpen el flujo del agente.
 */
export async function dispatchEvent(
  event: OutboundEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseServerClient();

  // Webhooks activos suscriptos a este evento (events es text[]).
  const { data: webhooks, error } = await supabase
    .from("outbound_webhooks")
    .select("*")
    .eq("active", true)
    .contains("events", [event]);

  if (error) {
    console.error("[dispatcher] error consultando webhooks:", error.message);
    return;
  }
  if (!webhooks || webhooks.length === 0) return;

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  await Promise.allSettled(
    webhooks.map((webhook) => deliverOne(webhook, event, body, payload)),
  );
}

async function deliverOne(
  webhook: { id: string; url: string; secret: string | null },
  event: OutboundEvent,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseServerClient();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-webhook-event": event,
  };
  // Firma HMAC-SHA256 del body. Usa el secret del webhook si tiene; si no,
  // el secret global de la app. Permite al receptor verificar autenticidad.
  const signingSecret = webhook.secret ?? serverEnv().WEBHOOK_SIGNING_SECRET;
  headers["x-webhook-signature"] =
    "sha256=" + createHmac("sha256", signingSecret).update(body).digest("hex");

  let responseStatus: number | null = null;
  let responseBody: string | null = null;

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    responseStatus = res.status;
    // Se trunca para no inflar la tabla con respuestas enormes.
    responseBody = (await res.text()).slice(0, 2000);
  } catch (err) {
    responseBody = err instanceof Error ? err.message : "error desconocido";
  }

  await supabase.from("outbound_webhook_deliveries").insert({
    webhook_id: webhook.id,
    event,
    payload: payload as never,
    response_status: responseStatus,
    response_body: responseBody,
    delivered_at: new Date().toISOString(),
  });
}
