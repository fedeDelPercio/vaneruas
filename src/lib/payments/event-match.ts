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

/** Devuelve el evento conocido por su slug (para mapear de vuelta a etiquetas). */
export function eventBySlug(slug: string | null | undefined): KnownComprobanteEvent | null {
  if (!slug) return null;
  return KNOWN_COMPROBANTE_EVENTS.find((e) => e.slug === slug) ?? null;
}
