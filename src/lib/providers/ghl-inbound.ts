import type { GhlInboundMessage } from "./ghl";

// ===========================================================================
// Planificación de adjuntos entrantes (lógica pura, testeable).
//
// Dada la lista de mensajes entrantes recientes de GHL, decide QUÉ adjuntos
// procesar y cómo mapear el texto del webhook. Separa la decisión (pura) de los
// efectos (descargar, subir, insertar), que viven en el endpoint del inbound.
//
// Reglas:
//  - Solo adjuntos de mensajes dentro de una ventana reciente (no backfillear
//    adjuntos viejos al deployar).
//  - Cada adjunto se procesa una sola vez: se descartan los ya procesados
//    (dedup por URL de origen).
//  - El caption de cada adjunto es el body del mensaje que lo trae (así una
//    imagen con texto conserva su texto, y las imágenes sueltas quedan sin).
//  - El texto del webhook se agrega como mensaje aparte SOLO si no es el caption
//    de algún adjunto nuevo (caso típico: un mensaje de texto puro).
// ===========================================================================

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

/**
 * URLs de adjuntos de mensajes recientes (dentro de la ventana), mapeadas a su
 * caption (body del mensaje que las trae). Más nuevo primero según `recent`.
 */
export function freshAttachmentCaptions(
  recent: GhlInboundMessage[],
  nowMs: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of recent) {
    const ts = m.dateAdded ? new Date(m.dateAdded).getTime() : NaN;
    const fresh = Number.isNaN(ts) || nowMs - ts < windowMs;
    if (!fresh) continue;
    for (const u of m.attachments) {
      if (!map.has(u)) map.set(u, (m.body ?? "").trim());
    }
  }
  return map;
}

export interface InboundPlan {
  /** Adjuntos nuevos a procesar, más viejo primero (orden natural de llegada). */
  attachments: { url: string; caption: string }[];
  /** Texto del webhook a guardar como mensaje aparte, o null. */
  textItem: string | null;
}

/**
 * Decide los adjuntos nuevos a procesar (deduplicando contra `processedUrls`) y
 * si el texto del webhook va como mensaje propio.
 */
export function planInbound(
  captions: Map<string, string>,
  processedUrls: Set<string>,
  webhookText: string,
): InboundPlan {
  const newUrls = [...captions.keys()].filter((u) => !processedUrls.has(u)).reverse();
  const attachments = newUrls.map((u) => ({ url: u, caption: captions.get(u) ?? "" }));
  const text = (webhookText ?? "").trim();
  const textItem = text && !attachments.some((a) => a.caption === text) ? text : null;
  return { attachments, textItem };
}
