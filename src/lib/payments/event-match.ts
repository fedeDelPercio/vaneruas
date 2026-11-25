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
  /** Fecha local del evento, si está confirmada. */
  eventDate?: string;
  /**
   * ¿Todavía tiene sentido dar el acceso al curso de este evento?
   *
   * Una masterclass que ya se dictó y cuya grabación venció no tiene nada que
   * entregar: inscribir a alguien ahí no le sirve de nada y solo ensucia la
   * worklist de "Falta acceso". Los eventos cerrados quedan en false y salen de
   * esa lista (el botón sigue disponible en Validados y Todos, por si hiciera
   * falta a mano).
   */
  accesoVigente?: boolean;
  /**
   * Palabra que identifica al evento en el título cargado en /events. La tabla
   * `events` no guarda el slug, así que la ficha del contacto en el chat une
   * los comprobantes con su evento buscando esta palabra en el título.
   */
  titleKeyword: string;
  /**
   * Evento sin alta en Tiendup (cupos adicionales fuera de la tienda): el pago
   * se aprueba en el panel y nada intenta inscribir a la persona. Implica
   * `accesoVigente: false`; el stepper y la ficha lo muestran como "Sin alta
   * Tiendup" en vez de "Falta el mail" o "Pendiente de alta".
   */
  sinTiendup?: boolean;
}

/** Slug del evento hermano de Peelings: cupos adicionales sin alta en Tiendup. */
export const EXTENSION_EVENT_SLUG = "masterclass-peelings-cupos-adicionales";

/**
 * Desde este instante (23:00 ART del 25/11/2026) la venta de Peelings pasó a
 * cupos adicionales excepcionales. Los comprobantes que llegan desde acá se
 * guardan con EXTENSION_EVENT_SLUG. Mismo corte que `plazos.ts`.
 */
export const EXTENSION_CUTOFF_ISO = "2026-11-25T23:00:00-03:00";

export const KNOWN_COMPROBANTE_EVENTS: KnownComprobanteEvent[] = [
  {
    slug: "congreso",
    label: "Skin Intellectuals Congress",
    shortLabel: "Congreso",
    amount: 267000,
    titleKeyword: "congress",
  },
  {
    slug: "masterclass-higiene-facial-dermaplaning",
    label: "Masterclass Higiene Facial Profunda + Dermaplaning",
    // Hay más de una masterclass: el badge dice cuál, no solo "Masterclass".
    shortLabel: "Higiene facial",
    amount: 105000,
    titleKeyword: "higiene",
    eventDate: "2026-08-01",
    // Se dictó el 1/8/2026 y la grabación venció el 21/8. En Tiendup el curso
    // quedó en borrador: no hay acceso que dar.
    accesoVigente: false,
  },
  {
    slug: "masterclass-peelings-verano",
    label: "Masterclass Peelings de Verano Masterizado",
    shortLabel: "Peelings",
    // Precio por transferencia (el de tarjeta, $150.000, va por Mercado Pago y
    // no manda comprobante por WhatsApp).
    amount: 110000,
    accesoVigente: true,
    titleKeyword: "peelings",
    eventDate: "2026-11-28",
  },
  {
    // Evento hermano de Peelings: cupos adicionales excepcionales desde el cierre
    // de la venta. No matchea por monto (el mismo comprobante de $110.000 puede
    // ser de la venta normal o de la extensión): lo decide la fecha de llegada
    // del comprobante, ver resolveStoredEventSlug.
    slug: EXTENSION_EVENT_SLUG,
    label: "Masterclass Peelings de Verano Masterizado (cupo adicional)",
    shortLabel: "Peelings · cupo adicional",
    amount: 0,
    accesoVigente: false,
    sinTiendup: true,
    titleKeyword: "peelings",
    eventDate: "2026-11-28",
  },
];

/**
 * ¿Para este evento todavía se entrega acceso al curso? Default true: un evento
 * nuevo entrega hasta que alguien lo cierre explícitamente.
 */
export function accesoVigenteDeEvento(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const ev = KNOWN_COMPROBANTE_EVENTS.find((e) => e.slug === slug);
  return ev ? ev.accesoVigente !== false && !ev.sinTiendup : false;
}

/** Identifica el evento de un comprobante por su monto exacto, o null. */
export function matchEventByAmount(
  amount: number | null | undefined,
): KnownComprobanteEvent | null {
  if (amount === null || amount === undefined) return null;
  const rounded = Math.round(amount);
  // El evento hermano no matchea por monto (amount 0): lo decide la fecha.
  return KNOWN_COMPROBANTE_EVENTS.find((e) => e.amount > 0 && e.amount === rounded) ?? null;
}

// Evento por default cuando el monto NO matchea (típicamente porque el OCR de
// visión no pudo leer el comprobante y `amount` viene null). Tiene que apuntar
// SIEMPRE a la venta abierta del momento: un comprobante ilegible es, casi con
// certeza, de lo que se está vendiendo hoy.
//
// Hoy esa venta es la Masterclass de Peelings de Verano (28/11/2026). El
// Congreso ya pasó y la masterclass de Higiene Facial cerró en agosto.
//
// OJO: esto hay que actualizarlo en CADA lanzamiento nuevo. La noche del
// lanzamiento de Peelings entraron 63 comprobantes en 40 minutos, todos sin
// monto legible, y quedaron etiquetados como la masterclass de agosto: el botón
// "Dar acceso al curso" los habría inscripto al curso equivocado en Tiendup.
export const DEFAULT_COMPROBANTE_EVENT_SLUG = "masterclass-peelings-verano";

/**
 * Slug de evento para GUARDAR en payment_validations. Usa el match por monto y,
 * si no matchea, cae al default (masterclass). Se usa solo para el valor
 * persistido (panel/entrega); el contexto del agente sigue usando
 * `matchEventByAmount` (que devuelve null cuando no está seguro, para no
 * afirmarle al cliente un evento que no leyó).
 */
export function resolveStoredEventSlug(
  amount: number | null | undefined,
  now: Date | number = Date.now(),
): string {
  const slug = matchEventByAmount(amount)?.slug ?? DEFAULT_COMPROBANTE_EVENT_SLUG;
  // Desde el corte, lo que habría sido de Peelings es un cupo adicional (sin
  // alta en Tiendup). Los otros eventos (Congreso, Higiene) no cambian.
  if (slug === DEFAULT_COMPROBANTE_EVENT_SLUG && new Date(now).getTime() >= Date.parse(EXTENSION_CUTOFF_ISO)) {
    return EXTENSION_EVENT_SLUG;
  }
  return slug;
}

/** ¿Es un evento sin alta en Tiendup (cupos adicionales)? */
export function esEventoSinTiendup(slug: string | null | undefined): boolean {
  return eventBySlug(slug)?.sinTiendup === true;
}

/** Devuelve el evento conocido por su slug (para mapear de vuelta a etiquetas). */
export function eventBySlug(slug: string | null | undefined): KnownComprobanteEvent | null {
  if (!slug) return null;
  return KNOWN_COMPROBANTE_EVENTS.find((e) => e.slug === slug) ?? null;
}
