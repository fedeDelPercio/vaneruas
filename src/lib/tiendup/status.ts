// ===========================================================================
// Estado en vivo del acceso a Tiendup de una persona, por curso.
//
// Puro y sin "server-only" (tests sin red en scripts/test-tiendup-status.ts).
// La lectura del listado y el cache viven en status-server.ts.
//
// Lo usa el bloque "Tiendup" de la ficha del contacto (solo lectura). El alta
// (grant.ts) aplica la misma idea con customer-gate.ts: si el correo no está
// en el curso NI existe como cliente de la tienda, el alta automática no
// inscribe y guarda "NOT_IN_TIENDUP: …" en course_access_error (messages.ts),
// que acá se lee como `not_found` aunque Tiendup no responda.
// ===========================================================================

import { findCustomerByEmail, type TiendupCustomer } from "./customers";
import { findExistingEnrollment, type TiendupEnrolled } from "./match";
import { isNotInTiendupError, tidyTiendupError } from "./messages";
import { MERGED_NOTE_PREFIX } from "../payments/dismiss";

export type TiendupLiveState =
  | "enrolled"
  | "other_email"
  | "customer_not_enrolled"
  | "not_found"
  | "error"
  | "unavailable";

export interface TiendupCourseStatus {
  courseId: number;
  /** Título del evento (para mostrar), si se conoce. */
  title: string;
  state: TiendupLiveState;
  /** other_email: el correo con el que figura, enmascarado (ma***@gm***.com). */
  otherEmailMasked?: string | null;
  /** error: lo que guardó el último intento de alta (course_access_error). */
  error?: string | null;
}

/**
 * Línea 1 del bloque: ¿el mail existe en Tiendup? Independiente del evento.
 *   - has_courses: figura con ese mail en algún curso mapeado (`courses` dice cuáles).
 *   - customer_no_courses: es cliente de la tienda pero no figura en ningún curso mapeado.
 *   - other_email: no figura con ese mail, pero sí alguien con el mismo nombre.
 *   - not_found: no figura (listados completos, o lo registró el alta automática).
 *   - unavailable: no se pudo comprobar.
 *   - no_email: la conversación no tiene un correo válido guardado.
 */
export type TiendupMailState =
  | "has_courses"
  | "customer_no_courses"
  | "other_email"
  | "not_found"
  | "unavailable"
  | "no_email";

export interface TiendupMailStatus {
  state: TiendupMailState;
  /** Títulos de los cursos donde figura con el mail. */
  courses: string[];
  otherEmailMasked?: string | null;
}

/**
 * Línea 2 del bloque: el acceso para la inscripción ACTUAL (el último
 * comprobante no rechazado), contra el curso mapeado a SU evento.
 *   - enrolled: figura con el mail en ESE curso.
 *   - granted: el alta de este comprobante salió bien (no se pudo releer el listado).
 *   - granted_missing: el alta quedó marcada pero el listado completo no la muestra.
 *   - other_email: en ese curso figura alguien con el mismo nombre y otro mail.
 *   - awaiting_approval: el pago todavía no está aprobado.
 *   - pending: aprobado, sin alta todavía.
 *   - not_found: aprobado, el alta automática frenó porque el mail no figura en Tiendup.
 *   - error: el último intento de alta falló (texto en `error`).
 *   - no_mapping: el evento no tiene curso de Tiendup mapeado.
 *   - unavailable: no se pudo comprobar.
 */
export type TiendupAccessState =
  | "enrolled"
  | "granted"
  | "granted_missing"
  | "other_email"
  | "awaiting_approval"
  | "pending"
  | "not_found"
  | "error"
  | "no_mapping"
  | "unavailable";

export interface TiendupAccessStatus {
  eventSlug: string | null;
  eventTitle: string;
  courseId: number | null;
  state: TiendupAccessState;
  error?: string | null;
  otherEmailMasked?: string | null;
}

/** Respuesta de GET /api/wa/tiendup-status/[conversationId]. */
export interface TiendupStatusResponse {
  /** false = no corresponde mostrar el bloque (sin comprobante pendiente ni aprobado). */
  show: boolean;
  /**
   * Hay un pago aprobado con curso mapeado al que dar el alta desde la ficha
   * ("Enviar a Tiendup", ver pickEnrollablePayment).
   */
  canEnroll?: boolean;
  /** Línea 1: validación del mail en Tiendup. */
  mail?: TiendupMailStatus | null;
  /** Línea 2: acceso a la inscripción actual. null = no hay inscripción. */
  current?: TiendupAccessStatus | null;
  /** Estado crudo por curso mapeado (diagnóstico). */
  courses: TiendupCourseStatus[];
}

/**
 * Línea 1. `perCourse`: estado de cada curso mapeado ya decidido con
 * decideTiendupStatus (mismo mail). `isCustomer`: el mail está en GET
 * /customers (null = no se pudo saber); `customersComplete`: el listado de
 * clientes vino completo.
 */
export function decideMailStatus(args: {
  perCourse: { title: string; state: TiendupLiveState; otherEmailMasked?: string | null }[];
  isCustomer: boolean | null;
  customersComplete: boolean;
  notInMarker: boolean;
}): TiendupMailStatus {
  const courses = args.perCourse.filter((c) => c.state === "enrolled").map((c) => c.title);
  if (courses.length) return { state: "has_courses", courses };
  if (args.isCustomer || args.perCourse.some((c) => c.state === "customer_not_enrolled")) {
    return { state: "customer_no_courses", courses: [] };
  }
  const other = args.perCourse.find((c) => c.state === "other_email");
  if (other) return { state: "other_email", courses: [], otherEmailMasked: other.otherEmailMasked ?? null };
  if (args.perCourse.some((c) => c.state === "not_found") || (args.isCustomer === false && args.customersComplete)) {
    return { state: "not_found", courses: [] };
  }
  if (args.notInMarker) return { state: "not_found", courses: [] };
  return { state: "unavailable", courses: [] };
}

/**
 * Línea 2: acceso de la inscripción actual. `courseState` es el estado del
 * curso mapeado al evento de ESE comprobante (null si el evento no mapea);
 * figurar en otro curso no cuenta.
 */
export function decideCurrentAccess(args: {
  paymentStatus: string;
  granted: boolean;
  courseId: number | null;
  courseState: { state: TiendupLiveState; otherEmailMasked?: string | null; error?: string | null } | null;
  listingComplete: boolean;
}): { state: TiendupAccessState; error?: string | null; otherEmailMasked?: string | null } {
  if (!args.courseId || !args.courseState) return { state: "no_mapping" };
  const cs = args.courseState;
  if (cs.state === "enrolled") return { state: "enrolled" };
  if (args.granted) return { state: args.listingComplete ? "granted_missing" : "granted" };
  if (cs.state === "other_email") return { state: "other_email", otherEmailMasked: cs.otherEmailMasked ?? null };
  if (args.paymentStatus !== "validated") return { state: "awaiting_approval" };
  if (cs.state === "error") return { state: "error", error: cs.error ?? null };
  if (cs.state === "not_found") return { state: "not_found" };
  // Listado del curso completo y no figura: pendiente aunque no se haya
  // consultado la lista de clientes (p. ej. porque ya figura en otro curso).
  if (cs.state === "unavailable" && !args.listingComplete) return { state: "unavailable" };
  return { state: "pending" };
}

/**
 * Decide el estado de UN curso. Orden:
 *   1. Con el listado de inscriptos completo, manda lo que dice Tiendup:
 *      figura con el correo → `enrolled`; figura la persona con otro correo →
 *      `other_email`.
 *   2. Si el último intento de alta dejó un error real guardado → `error`, con
 *      ese texto. (El marcador NOT_IN_TIENDUP no cuenta como error: es el
 *      `not_found` que registró el alta automática.)
 *   3. No inscripta (listado de inscriptos completo):
 *      - el correo existe como cliente de la tienda → `customer_not_enrolled`
 *        (alcanza con verlo en un listado de clientes parcial: es prueba
 *        positiva);
 *      - listado de clientes completo y no está → `not_found`;
 *      - clientes sin datos completos → `not_found` si el alta dejó el
 *        marcador NOT_IN_TIENDUP; si no, `unavailable`.
 *   4. Inscriptos incompletos o caídos (o sin key): `not_found` si hay
 *      marcador NOT_IN_TIENDUP (y Tiendup no muestra el correo como cliente),
 *      si no `unavailable`: no se afirma nada que no se pudo comprobar.
 */
export function decideTiendupStatus(args: {
  listing: { enrolled: TiendupEnrolled[]; complete: boolean } | null;
  /** Clientes de la tienda (GET /customers). null = no se consultó / sin key. */
  customers?: { customers: TiendupCustomer[]; complete: boolean } | null;
  email: string;
  fullName: string | null;
  lastError: string | null;
}): { state: TiendupLiveState; otherEmailMasked?: string | null; error?: string | null } {
  const listing = args.listing;
  const complete = Boolean(listing?.complete);
  if (listing && complete) {
    const match = findExistingEnrollment({
      enrolled: listing.enrolled,
      email: args.email,
      fullName: args.fullName,
    });
    if (match?.matchedBy === "email") return { state: "enrolled" };
    if (match?.matchedBy === "nombre") {
      return { state: "other_email", otherEmailMasked: maskEmail(match.enrolled.email) };
    }
  }
  const lastError = args.lastError?.trim() || null;
  const notInMarker = isNotInTiendupError(lastError);
  if (lastError && !notInMarker) return { state: "error", error: tidyTiendupError(lastError) };

  const customers = args.customers ?? null;
  const isCustomer = Boolean(customers && findCustomerByEmail(customers.customers, args.email));
  if (complete) {
    if (isCustomer) return { state: "customer_not_enrolled" };
    if (customers?.complete) return { state: "not_found" };
    return { state: notInMarker ? "not_found" : "unavailable" };
  }
  if (notInMarker && !isCustomer) return { state: "not_found" };
  return { state: "unavailable" };
}

/**
 * Enmascara un correo para mostrarlo sin exponerlo entero:
 * "maria.perez@gmail.com" → "ma***@gm***.com". El sufijo después del primer
 * punto del dominio queda visible (".com", ".com.ar").
 */
export function maskEmail(email: string | null | undefined): string | null {
  const e = email?.trim();
  if (!e) return null;
  const at = e.lastIndexOf("@");
  if (at < 1) return `${e.slice(0, 2)}***`;
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const dot = domain.indexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const suffix = dot > 0 ? domain.slice(dot) : "";
  return `${user.slice(0, 2)}***@${host.slice(0, 2)}***${suffix}`;
}

/** Marcas de agent_notifications.reason que prueban un intento de alta (messages.ts). */
const ATTEMPT_REASON_RE = /^tiendup_(?:alta_pendiente|aviso_sin_enviar)_(.+)$/;

/**
 * Comprobantes con algún intento de alta en Tiendup: acceso marcado
 * (`course_access_granted_at`), error guardado (`course_access_error`) o una
 * notificación de sistema de Tiendup que los nombra (`tiendup_alta_pendiente_<id>`,
 * `tiendup_aviso_sin_enviar_<id>`). Devuelve los ids.
 */
export function paymentsWithEnrollAttempt(args: {
  payments: { id: string; course_access_granted_at: string | null; course_access_error: string | null }[];
  notificationReasons: (string | null)[];
}): Set<string> {
  const ids = new Set<string>();
  for (const p of args.payments) {
    if (p.course_access_granted_at || p.course_access_error?.trim()) ids.add(p.id);
  }
  const known = new Set(args.payments.map((p) => p.id));
  for (const r of args.notificationReasons) {
    const m = r ? ATTEMPT_REASON_RE.exec(r) : null;
    if (m && known.has(m[1]!)) ids.add(m[1]!);
  }
  return ids;
}

/**
 * Pago al que se le da el alta desde la ficha: el comprobante aprobado
 * (`validated`, no agrupado) más reciente cuyo evento tiene curso de Tiendup
 * mapeado. `payments` en cualquier orden; `hasCourse` dice si el evento mapea
 * (tiendupCourseIdForEvent, que es server-only). null si no hay.
 */
export function pickEnrollablePayment<
  T extends { status: string; event_slug: string | null; created_at: string; validation_note?: string | null },
>(payments: readonly T[], hasCourse: (eventSlug: string | null) => boolean): T | null {
  return (
    payments
      .filter(
        (p) =>
          p.status === "validated" &&
          !(p.validation_note ?? "").startsWith(MERGED_NOTE_PREFIX) &&
          hasCourse(p.event_slug),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

/**
 * Cómo se muestra el campo de mail + "Enviar a Tiendup" en el bloque de la
 * ficha:
 *   - "highlight": hay que actuar (sin mail, o la inscripción actual está en
 *     error / no figura / pendiente / alta marcada que no figura / otro mail /
 *     sin verificar): visible y destacado para cargar el mail y reintentar;
 *   - "collapsed": el acceso ya está enviado (enrolled / granted): detrás de
 *     un link "Corregir mail";
 *   - "normal": el resto (falta aprobar el pago, sin curso mapeado, sin
 *     inscripción actual).
 */
export type TiendupEditorMode = "highlight" | "collapsed" | "normal";

const EDITOR_ATTENTION: ReadonlySet<TiendupAccessState> = new Set<TiendupAccessState>([
  "error",
  "not_found",
  "pending",
  "granted_missing",
  "other_email",
  "unavailable",
]);

export function tiendupEditorMode(args: {
  mailState: TiendupMailState | null | undefined;
  accessState: TiendupAccessState | null | undefined;
  savedEmail: string | null | undefined;
}): TiendupEditorMode {
  if (args.accessState === "enrolled" || args.accessState === "granted") return "collapsed";
  if (!args.savedEmail?.trim() || args.mailState === "no_email") return "highlight";
  if (args.accessState && EDITOR_ATTENTION.has(args.accessState)) return "highlight";
  return "normal";
}
