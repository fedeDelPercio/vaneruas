import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { normalizeContactEmail } from "@/lib/contact-email";
import { eventBySlug } from "@/lib/payments/event-match";
import {
  findCustomerByEmail,
  fixDominioDeCorreo,
  listCustomersChecked,
  listEnrolledChecked,
  tiendupCourseIdForEvent,
  tiendupMappedCourses,
  type CustomersListing,
} from "./client";
import { isNotInTiendupError, tidyTiendupError } from "./messages";
import type { TiendupEnrolled } from "./match";
import {
  decideCurrentAccess,
  decideMailStatus,
  decideTiendupStatus,
  pickEnrollablePayment,
  type TiendupAccessStatus,
  type TiendupCourseStatus,
  type TiendupStatusResponse,
} from "./status";

// ===========================================================================
// Estado en vivo del acceso a Tiendup de una conversación (solo lectura, solo
// GET a Tiendup). Lo sirve GET /api/wa/tiendup-status/[conversationId] para el
// bloque "Tiendup" de la ficha; la decisión pura está en status.ts.
//
// Además del listado de inscriptos (cache acá, 5 min por curso) consulta el
// listado de clientes de la tienda (listCustomersChecked, cache de 10 min
// compartida con el alta) solo si la persona no figura en algún curso, para
// distinguir `customer_not_enrolled` de `not_found`.
// ===========================================================================

type Db = SupabaseClient<Database>;

type Listing = { enrolled: TiendupEnrolled[]; complete: boolean };

// Cache en memoria del server, por curso: el listado de inscriptos son varias
// páginas y la ficha se abre seguido. 5 min si vino completo; si vino cortado
// o falló, 1 min (para no martillar a Tiendup mientras está caído, pero
// reintentar pronto). Vive por instancia (en Vercel cada lambda tiene el suyo).
const TTL_OK_MS = 5 * 60_000;
const TTL_FAIL_MS = 60_000;
const cache = new Map<number, { at: number; value: Listing }>();
const inflight = new Map<number, Promise<Listing>>();
// Sube con cada invalidación: una lectura que arrancó antes no pisa el cache.
const generation = new Map<number, number>();

/**
 * Descarta el listado cacheado de un curso (tras un alta desde el panel, para
 * que la ficha muestre el estado nuevo y no el de hace 5 min).
 */
export function invalidateEnrolledListing(courseId: number): void {
  cache.delete(courseId);
  inflight.delete(courseId);
  generation.set(courseId, (generation.get(courseId) ?? 0) + 1);
}

/**
 * Listado de inscriptos de un curso, con cache. null si no hay
 * `TIENDUP_API_KEY` (el estado queda `unavailable`).
 */
export async function getEnrolledListing(courseId: number): Promise<Listing | null> {
  if (!process.env.TIENDUP_API_KEY) return null;
  const hit = cache.get(courseId);
  if (hit && Date.now() - hit.at < (hit.value.complete ? TTL_OK_MS : TTL_FAIL_MS)) return hit.value;
  const running = inflight.get(courseId);
  if (running) return running;
  const gen = generation.get(courseId) ?? 0;
  const p = listEnrolledChecked(courseId)
    .then((value) => {
      if ((generation.get(courseId) ?? 0) === gen) cache.set(courseId, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      if (inflight.get(courseId) === p) inflight.delete(courseId);
    });
  inflight.set(courseId, p);
  return p;
}

/**
 * Estado de Tiendup de una conversación, en dos líneas:
 *   1. `mail`: si el correo existe en Tiendup (en qué cursos mapeados figura,
 *      cliente sin cursos, no figura…), independiente del evento.
 *   2. `current`: el acceso a la inscripción ACTUAL (último comprobante no
 *      rechazado) contra el curso mapeado a SU evento. Figurar en otro curso
 *      NO cuenta como acceso a este.
 * `show: false` si no tiene ningún comprobante pendiente/aprobado. Sin correo
 * válido se muestra igual, con el mail en `no_email` (el equipo lo puede
 * cargar desde la ficha). null = la conversación no existe (para este cliente).
 */
export async function loadTiendupStatus(
  sb: Db,
  conversationId: string,
  clientSlug: string,
): Promise<TiendupStatusResponse | null> {
  const [convRes, payRes] = await Promise.all([
    sb
      .from("conversations")
      .select("id, contact_email, display_name")
      .eq("id", conversationId)
      .eq("client_slug", clientSlug)
      .maybeSingle(),
    sb
      .from("payment_validations")
      .select("id, event_slug, status, validation_note, course_access_granted_at, course_access_error, updated_at, created_at")
      .eq("conversation_id", conversationId)
      .eq("client_slug", clientSlug)
      .in("status", ["validated", "pending"])
      .order("created_at", { ascending: false }),
  ]);
  const failed = [convRes, payRes].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const conv = convRes.data;
  if (!conv) return null;

  const valid = normalizeContactEmail(conv.contact_email);
  const payments = payRes.data ?? [];
  if (!payments.length) return { show: false, courses: [] };
  const canEnroll = Boolean(pickEnrollablePayment(payments, (slug) => tiendupCourseIdForEvent(slug) !== null));

  // Inscripción actual: el comprobante aprobado más nuevo; si no hay, el
  // pendiente más nuevo.
  const current = payments.find((p) => p.status === "validated") ?? payments[0]!;
  const currentCourseId = tiendupCourseIdForEvent(current.event_slug);
  const currentError = current.course_access_granted_at ? null : current.course_access_error?.trim() || null;
  const notInMarker = isNotInTiendupError(currentError);
  const currentBase = {
    eventSlug: current.event_slug,
    eventTitle: eventBySlug(current.event_slug)?.label ?? current.event_slug ?? "evento sin identificar",
    courseId: currentCourseId,
  };

  // Sin correo válido: el bloque se muestra igual (es justo el caso en que el
  // equipo carga el correo a mano desde la ficha). No se consulta Tiendup: la
  // línea del acceso sale de lo guardado en el comprobante.
  if (!valid) {
    const access = decideCurrentAccess({
      paymentStatus: current.status,
      granted: Boolean(current.course_access_granted_at),
      courseId: currentCourseId,
      courseState: currentCourseId
        ? currentError && !notInMarker
          ? { state: "error", error: tidyTiendupError(currentError) }
          : { state: "unavailable" }
        : null,
      // Sin listado: "granted" (no "granted_missing") si ya tenía el alta, y
      // "pending" (no "unavailable") si está aprobado sin alta.
      listingComplete: !current.course_access_granted_at,
    });
    return {
      show: true,
      canEnroll,
      mail: { state: "no_email", courses: [] },
      current: { ...currentBase, ...access },
      courses: [],
    };
  }
  // Mismo correo que usa el alta (grant.ts): con el typo de dominio corregido.
  const email = fixDominioDeCorreo(valid).email;

  let customersP: Promise<CustomersListing | null> | null = null;
  const getCustomers = () =>
    (customersP ??= process.env.TIENDUP_API_KEY ? listCustomersChecked() : Promise.resolve(null));

  const mapped = tiendupMappedCourses();
  const listings = new Map<number, Listing | null>(
    await Promise.all(mapped.map(async (m) => [m.courseId, await getEnrolledListing(m.courseId)] as const)),
  );
  const titleOf = (slug: string, courseId: number) => eventBySlug(slug)?.label ?? `Curso ${courseId}`;

  // Por curso, sin error guardado: lo que dicen los listados.
  let perCourse = mapped.map((m) => ({
    courseId: m.courseId,
    title: titleOf(m.eventSlug, m.courseId),
    ...decideTiendupStatus({ listing: listings.get(m.courseId) ?? null, email, fullName: conv.display_name, lastError: null }),
  }));
  let customers: CustomersListing | null = null;
  if (!perCourse.some((c) => c.state === "enrolled")) {
    customers = await getCustomers();
    if (customers) {
      const cust = customers;
      perCourse = mapped.map((m) => ({
        courseId: m.courseId,
        title: titleOf(m.eventSlug, m.courseId),
        ...decideTiendupStatus({
          listing: listings.get(m.courseId) ?? null,
          customers: cust,
          email,
          fullName: conv.display_name,
          lastError: null,
        }),
      }));
    }
  }
  const isCustomer = customers ? Boolean(findCustomerByEmail(customers.customers, email)) : null;
  const mail = decideMailStatus({
    perCourse,
    isCustomer,
    customersComplete: Boolean(customers?.complete),
    notInMarker,
  });

  // Línea 2: contra el curso del evento actual, con su error guardado.
  let courseState: ReturnType<typeof decideTiendupStatus> | null = null;
  const currentListing = currentCourseId ? listings.get(currentCourseId) ?? null : null;
  if (currentCourseId) {
    courseState = decideTiendupStatus({
      listing: currentListing,
      customers,
      email,
      fullName: conv.display_name,
      lastError: currentError,
    });
  }
  const access = decideCurrentAccess({
    paymentStatus: current.status,
    granted: Boolean(current.course_access_granted_at),
    courseId: currentCourseId,
    courseState,
    listingComplete: Boolean(currentListing?.complete),
  });
  const currentStatus: TiendupAccessStatus = { ...currentBase, ...access };

  const courses: TiendupCourseStatus[] = perCourse.map((c) => ({
    courseId: c.courseId,
    title: c.title,
    state: c.state,
    otherEmailMasked: c.otherEmailMasked ?? null,
  }));
  return { show: true, canEnroll, mail, current: currentStatus, courses };
}
