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
 * Devuelve el `messageId` que asigna GHL (lo guardamos para deduplicar el
 * webhook OutboundMessage de la app: así no re-ingerimos nuestros propios
 * envíos como si fueran de un humano). Lanza si la API responde con error.
 */
export async function ghlSendWhatsApp(
  contactId: string,
  message: string,
): Promise<string | null> {
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

  const data = (await res.json().catch(() => null)) as { messageId?: string } | null;
  return data?.messageId ?? null;
}

function ghlHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY ?? ""}`,
    Version: GHL_VERSION,
    Accept: "application/json",
  };
}

export interface GhlInboundMessage {
  body: string;
  /** URLs de los adjuntos (imágenes, PDF, audio). */
  attachments: string[];
  messageType: string | null;
}

/**
 * Trae el último mensaje ENTRANTE del contacto vía la API de GHL. El webhook
 * del workflow "Customer Replied" no incluye la URL de los adjuntos; esto la
 * recupera (search de conversación -> mensajes -> último inbound). Usa el PIT.
 */
export async function ghlFetchLatestInbound(
  contactId: string,
  locationId: string,
): Promise<GhlInboundMessage | null> {
  if (!process.env.GHL_API_KEY) return null;
  try {
    const sUrl = `${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(
      locationId,
    )}&contactId=${encodeURIComponent(contactId)}`;
    const sRes = await fetch(sUrl, { headers: ghlHeaders(), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    if (!sRes.ok) return null;
    const sData = (await sRes.json()) as { conversations?: { id: string }[] };
    const conversationId = sData.conversations?.[0]?.id;
    if (!conversationId) return null;

    const mRes = await fetch(`${GHL_BASE}/conversations/${conversationId}/messages?limit=5`, {
      headers: ghlHeaders(),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!mRes.ok) return null;
    const mData = (await mRes.json()) as {
      messages?: { messages?: GhlRawMessage[] } | GhlRawMessage[];
    };
    const list = Array.isArray(mData.messages)
      ? mData.messages
      : mData.messages?.messages ?? [];
    const latest = list.find((m) => (m.direction ?? "").toLowerCase() === "inbound");
    if (!latest) return null;
    return {
      body: latest.body ?? "",
      attachments: Array.isArray(latest.attachments)
        ? latest.attachments.filter((a): a is string => typeof a === "string")
        : [],
      messageType: latest.messageType ?? null,
    };
  } catch {
    return null;
  }
}

interface GhlRawMessage {
  direction?: string;
  body?: string;
  attachments?: unknown[];
  messageType?: string;
}

/** Baja un archivo de una URL (las URLs de adjuntos de GHL son públicas). */
export async function downloadUrl(
  url: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType };
  } catch {
    return null;
  }
}
