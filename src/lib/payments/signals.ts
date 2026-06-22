// Señales de pago en el texto que acompaña a un adjunto. PURA (sin server-only),
// testeable de forma aislada.
//
// La usa el intake de adjuntos como salvaguarda: la clasificación con vision a
// veces marca "otro" un comprobante REAL (capturas de transferencia, PDFs raros,
// imágenes de baja calidad). Si el texto que acompaña al adjunto habla de un
// pago, NUNCA queremos mandar a esa persona al flujo conversacional (que podría
// contestarle "agotado"): la tratamos como comprobante y seguimos el juego
// normal. Regla dura del producto: a quien manda su comprobante, flujo de pago.

// Nota: sin `\b` de cierre a propósito. Muchas palabras en español terminan en
// vocal acentuada ("pagué", "transferí", "aboné") y la `é`/`í` no es un
// word-char ASCII, así que un `\b` final no matchea. El `\b` de apertura alcanza
// para no gatillar en mitad de otra palabra.
const PAYMENT_SIGNAL_RE =
  /\b(comprobante|transfer\w*|dep[oó]sit\w*|pagu[eé]|pago|pag[oó]|pagar|pagad\w*|abon\w*|se[ñn]a|reserv\w*|cupos?|entradas?|inscrib\w*|inscrip\w*)|\$\s?\d|\b\d{1,3}\.\d{3}/i;

/**
 * ¿El texto que acompaña a un adjunto sugiere que es (o viene con) un pago?
 * Devuelve false para captions vacíos o placeholders del canal (ej. "[imagen]").
 */
export function captionLooksLikePayment(caption: string | null | undefined): boolean {
  const c = (caption ?? "").trim();
  if (!c || c.startsWith("[")) return false;
  return PAYMENT_SIGNAL_RE.test(c);
}
