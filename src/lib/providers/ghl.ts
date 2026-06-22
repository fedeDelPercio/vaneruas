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
  /** ISO date del mensaje en GHL (para acotar a los recientes). */
  dateAdded: string | null;
}

/**
 * Trae los mensajes ENTRANTES recientes del contacto vía la API de GHL (el
 * webhook del workflow "Customer Replied" no incluye las URLs de los adjuntos).
 * Devuelve la lista (más nuevo primero) para que el inbound: (a) matchee el
 * mensaje que disparó el webhook por su texto y (b) procese TODOS los adjuntos
 * recientes (varios comprobantes llegan como mensajes separados), deduplicando
 * por URL. Usa el PIT. Devuelve [] ante cualquier error.
 */
export async function ghlFetchRecentInbound(
  contactId: string,
  locationId: string,
  limit = 10,
): Promise<{ conversationId: string | null; messages: GhlInboundMessage[] }> {
  if (!process.env.GHL_API_KEY) return { conversationId: null, messages: [] };
  try {
    const sUrl = `${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(
      locationId,
    )}&contactId=${encodeURIComponent(contactId)}`;
    const sRes = await fetch(sUrl, { headers: ghlHeaders(), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    if (!sRes.ok) return { conversationId: null, messages: [] };
    const sData = (await sRes.json()) as { conversations?: { id: string }[] };
    const conversationId = sData.conversations?.[0]?.id ?? null;
    if (!conversationId) return { conversationId: null, messages: [] };

    const mRes = await fetch(`${GHL_BASE}/conversations/${conversationId}/messages?limit=${limit}`, {
      headers: ghlHeaders(),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!mRes.ok) return { conversationId, messages: [] };
    const mData = (await mRes.json()) as {
      messages?: { messages?: GhlRawMessage[] } | GhlRawMessage[];
    };
    const list = Array.isArray(mData.messages)
      ? mData.messages
      : mData.messages?.messages ?? [];
    const messages = list
      .filter((m) => (m.direction ?? "").toLowerCase() === "inbound")
      .map((m) => ({
        body: m.body ?? "",
        attachments: Array.isArray(m.attachments)
          ? m.attachments.filter((a): a is string => typeof a === "string")
          : [],
        messageType: m.messageType ?? null,
        dateAdded: m.dateAdded ?? null,
      }));
    return { conversationId, messages };
  } catch {
    return { conversationId: null, messages: [] };
  }
}

interface GhlRawMessage {
  direction?: string;
  body?: string;
  attachments?: unknown[];
  messageType?: string;
  dateAdded?: string;
}

/**
 * Resuelve el id de conversación de GHL de un contacto (vía la Conversations
 * API). Lo usa el panel para armar el deep-link al thread EXACTO en GHL: la
 * URL de conversaciones de GHL se identifica por este conversationId, no por el
 * contactId. Usa el PIT. Devuelve null ante cualquier error o si no hay
 * conversación.
 */
export async function ghlFindConversationId(
  contactId: string,
  locationId: string,
): Promise<string | null> {
  if (!process.env.GHL_API_KEY) return null;
  try {
    const sUrl = `${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(
      locationId,
    )}&contactId=${encodeURIComponent(contactId)}`;
    const sRes = await fetch(sUrl, {
      headers: ghlHeaders(),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!sRes.ok) return null;
    const sData = (await sRes.json()) as { conversations?: { id: string }[] };
    return sData.conversations?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export interface GhlContact {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Trae el contacto de GHL por id (email + nombre + apellido). Usa el PIT.
 *
 * REQUIERE que el PIT tenga el scope `contacts.readonly` ("View Contacts"). Si
 * no lo tiene, GHL responde 401 y devolvemos null (fail-open: el llamador trata
 * al contacto como no registrado y sigue el flujo normal de hoy). Nunca lanza.
 */
export async function ghlFetchContact(contactId: string): Promise<GhlContact | null> {
  if (!process.env.GHL_API_KEY) return null;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        // La Contacts API usa una versión distinta a la de Conversations.
        Version: "2021-07-28",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { contact?: unknown } | null;
    const c = (data?.contact ?? data) as Record<string, unknown> | null;
    if (!c) return null;
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;
    return {
      email: str(c.email),
      firstName: str(c.firstName),
      lastName: str(c.lastName),
    };
  } catch {
    return null;
  }
}

/**
 * ¿El contacto de GHL cuenta como "profesional ya registrada"? (heurística
 * temporal, a afinar): tiene email cargado, O tiene nombre Y apellido (así están
 * agendadas las clientas de siempre). Un contacto auto-creado por WhatsApp
 * normalmente no tiene email ni apellido, así que no califica.
 */
export function ghlContactIsRegistered(contact: GhlContact | null): boolean {
  if (!contact) return false;
  if (contact.email) return true;
  if (contact.firstName && contact.lastName) return true;
  return false;
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
