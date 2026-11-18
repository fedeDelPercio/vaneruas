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
import { isNotInTiendupError } from "./messages";

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

/** Respuesta de GET /api/wa/tiendup-status/[conversationId]. */
export interface TiendupStatusResponse {
  /** false = no corresponde mostrar el bloque (sin correo válido o sin intentos de alta). */
  show: boolean;
  courses: TiendupCourseStatus[];
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
  if (lastError && !notInMarker) return { state: "error", error: lastError };

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
