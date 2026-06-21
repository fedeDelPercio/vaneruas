import "server-only";

// ===========================================================================
// Envío de mensajes salientes a WhatsApp vía GoHighLevel (coexistence).
//
// El worker, tras generar la respuesta del agente para una conversación
// source="whatsapp", llama acá para entregarla por el WhatsApp del contacto.
// GHL retransmite por el número conectado. Como respondemos a un inbound,
// estamos dentro de la ventana de 24h y el texto libre sale OK.
//
// GUARDRAIL (allowlist, fail-closed): solo se envía a los contact_id que
// estén en GHL_SEND_ALLOWLIST. Si la lista está vacía/sin setear, NO se manda
// a nadie. El comodín "*" habilita el envío a todos (producción).
// ===========================================================================

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";
const SEND_TIMEOUT_MS = 10000;

/**
 * ¿Está permitido enviar a este contacto?
 *   - lista vacía / sin setear  -> false (fail-closed: nadie)
 *   - "*"                       -> true  (todos, producción)
 *   - "id1,id2,..."             -> true solo si contactId está en la lista
 */
export function ghlSendAllowed(contactId: string): boolean {
  const raw = (process.env.GHL_SEND_ALLOWLIST ?? "").trim();
  if (!raw) return false;
  if (raw === "*") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(contactId);
}

/**
 * Envía un mensaje de WhatsApp al contacto vía la Conversations API de GHL.
 * Lanza si la API responde con error (el caller decide reintentar/encolar).
 */
export async function ghlSendWhatsApp(contactId: string, message: string): Promise<void> {
  const token = process.env.GHL_API_KEY;
  if (!token) throw new Error("GHL_API_KEY no configurada");

  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ type: "WhatsApp", contactId, message }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GHL send ${res.status}: ${body.slice(0, 300)}`);
  }
}
