// ===========================================================================
// Match de comprobante → evento por monto (HARDCODE temporal).
//
// Por ahora, los únicos comprobantes que llegan por WhatsApp son la seña por
// transferencia de dos eventos, cada uno con un monto exacto distinto. Eso
// alcanza para identificar automáticamente a qué evento corresponde un
// comprobante sin tener que preguntarle a la persona.
//
// TODO escalable: en vez de esta tabla fija, matchear el monto contra los
// precios/seña de la tabla `events` (transfer_price, etc.).
// ===========================================================================

export interface KnownComprobanteEvent {
  /** Slug que se guarda en payment_validations.event_slug. */
  slug: string;
  /** Nombre completo (para el contexto del agente). */
  label: string;
  /** Etiqueta corta (para el badge del panel de Aprobaciones). */
  shortLabel: string;
  /** Monto exacto del comprobante esperado, en ARS. */
  amount: number;
}

export const KNOWN_COMPROBANTE_EVENTS: KnownComprobanteEvent[] = [
  {
    slug: "congreso",
    label: "Skin Intellectuals Congress",
    shortLabel: "Congreso",
    amount: 267000,
  },
  {
    slug: "masterclass-higiene-facial-dermaplaning",
    label: "Masterclass Higiene Facial Profunda + Dermaplaning",
    shortLabel: "Masterclass",
    amount: 105000,
  },
];

/** Identifica el evento de un comprobante por su monto exacto, o null. */
export function matchEventByAmount(
  amount: number | null | undefined,
): KnownComprobanteEvent | null {
  if (amount === null || amount === undefined) return null;
  const rounded = Math.round(amount);
  return KNOWN_COMPROBANTE_EVENTS.find((e) => e.amount === rounded) ?? null;
}

// Evento por default cuando el monto NO matchea (típicamente porque el OCR de
// visión no pudo leer el comprobante y `amount` viene null). El Congreso está
// archivado/agotado desde el 24/06, así que la única venta activa por
// transferencia es la Masterclass: por eso un comprobante sin monto legible se
// asume masterclass. Esto destraba el botón "Dar acceso al curso" en el panel
// sin depender de un backfill manual cada vez. OJO: si en el futuro se abre otra
// venta por transferencia con otro precio, revisar este default (o el agente
// terminaría etiquetando mal los comprobantes ilegibles).
export const DEFAULT_COMPROBANTE_EVENT_SLUG =
  "masterclass-higiene-facial-dermaplaning";

/**
 * Slug de evento para GUARDAR en payment_validations. Usa el match por monto y,
 * si no matchea, cae al default (masterclass). Se usa solo para el valor
 * persistido (panel/entrega); el contexto del agente sigue usando
 * `matchEventByAmount` (que devuelve null cuando no está seguro, para no
 * afirmarle al cliente un evento que no leyó).
 */
export function resolveStoredEventSlug(
  amount: number | null | undefined,
): string {
  return matchEventByAmount(amount)?.slug ?? DEFAULT_COMPROBANTE_EVENT_SLUG;
}

/** Devuelve el evento conocido por su slug (para mapear de vuelta a etiquetas). */
export function eventBySlug(slug: string | null | undefined): KnownComprobanteEvent | null {
  if (!slug) return null;
  return KNOWN_COMPROBANTE_EVENTS.find((e) => e.slug === slug) ?? null;
}
