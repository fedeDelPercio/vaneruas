import "server-only";

// ===========================================================================
// Cliente de la API pública de Tiendup (entrega de acceso a cursos).
//
// Conexión: host por-negocio `https://<slug>.public-api.tiendup.com`, auth por
// header `x-api-key`. La key vive en `TIENDUP_API_KEY` (server-only). El host se
// puede override con `TIENDUP_BASE_URL`.
//
// Llamadas que usamos (todas con la misma key):
//   POST /learning/courses/{courseId}/enroll
//     body: { customer: { email, name?, last_name? }, enrollment_type: "paid" }
//     → crea el cliente en Tiendup si no existe + lo inscribe. Idempotente.
//     ÚNICA llamada que escribe.
//   GET  /learning/courses/{courseId}/enrolled?limit=100&page=N
//     → inscriptos al curso (listEnrolled / listEnrolledChecked).
//   GET  /customers?limit=100&page=N
//     → TODOS los clientes de la tienda (listCustomersChecked, customers.ts).
//     No hay búsqueda por correo: se recorre el listado y se busca en memoria.
// ===========================================================================

import type { TiendupEnrolled } from "./match";
import {
  createCustomersCache,
  fetchAllCustomers,
  type CustomersListing,
} from "./customers";

// El match contra el listado (puro, testeable sin red) vive en match.ts.
export {
  findExistingEnrollment,
  fixDominioDeCorreo,
  type ExistingEnrollment,
  type TiendupEnrolled,
} from "./match";
export { findCustomerByEmail, type CustomersListing, type TiendupCustomer } from "./customers";

const DEFAULT_BASE_URL = "https://vanesaruas.public-api.tiendup.com";
const TIMEOUT_MS = 20000;

// Mapeo evento (event_slug de payment_validations) → id de curso en Tiendup.
// Los ids salen de GET /learning/courses (los trae con su slug y su estado).
const TIENDUP_COURSE_BY_EVENT_SLUG: Record<string, number> = {
  "masterclass-higiene-facial-dermaplaning": 519060,
  "masterclass-peelings-verano": 554178,
};

/** Id de curso de Tiendup para un event_slug de comprobante, o null si no mapea. */
export function tiendupCourseIdForEvent(slug: string | null | undefined): number | null {
  if (!slug) return null;
  return TIENDUP_COURSE_BY_EVENT_SLUG[slug] ?? null;
}

function baseUrl(): string {
  return (process.env.TIENDUP_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export interface EnrollResult {
  ok: boolean;
  error?: string;
}

/**
 * Da acceso (inscribe) a un curso de Tiendup por email. Crea el cliente en
 * Tiendup si no existe. Idempotente (si ya está inscripto, devuelve ok).
 * Best-effort: nunca lanza; devuelve { ok:false, error } ante cualquier problema.
 */
export async function enrollCourseByEmail(args: {
  courseId: number;
  email: string;
  name?: string | null;
  lastName?: string | null;
  enrollmentType?: "free" | "paid";
}): Promise<EnrollResult> {
  const key = process.env.TIENDUP_API_KEY;
  if (!key) return { ok: false, error: "TIENDUP_API_KEY no configurada" };
  const email = args.email?.trim();
  if (!email) return { ok: false, error: "Falta el email del contacto" };

  const customer: Record<string, string> = { email };
  if (args.name?.trim()) customer.name = args.name.trim();
  if (args.lastName?.trim()) customer.last_name = args.lastName.trim();

  try {
    const res = await fetch(`${baseUrl()}/learning/courses/${args.courseId}/enroll`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ customer, enrollment_type: args.enrollmentType ?? "paid" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `Tiendup ${res.status}: ${text.slice(0, 200)}` };
    }
    // Respuesta esperada: {"status":"OK"}.
    try {
      const json = JSON.parse(text) as { status?: string };
      if (json.status && json.status !== "OK") {
        return { ok: false, error: `Tiendup respondió status ${json.status}` };
      }
    } catch {
      // Sin JSON parseable pero 2xx: lo damos por OK.
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Chequeo previo: ¿ya está inscripta? ----------------------------------
//
// CRÍTICO: el mail que capturamos por WhatsApp NO es confiable (typos, mails
// truncados, o la persona da un mail distinto al de su cuenta de Tiendup). Si
// inscribimos con un mail equivocado, Tiendup CREA un cliente nuevo con ese mail
// basura y la persona real sigue sin acceso. Por eso, antes de inscribir,
// buscamos si ya está en el curso (por mail o por NOMBRE) y avisamos.

// fixDominioDeCorreo vive en match.ts (puro, lo usan también los scripts).

/** Trae TODOS los inscriptos al curso (paginado). [] ante error. */
export async function listEnrolled(courseId: number): Promise<TiendupEnrolled[]> {
  return (await listEnrolledChecked(courseId)).enrolled;
}

/**
 * Igual que `listEnrolled`, pero avisa si el listado quedó completo. El alta
 * automática lo necesita: con un listado cortado no se puede descartar que la
 * persona ya figure con otro correo, y en ese caso no inscribe (lo deja para
 * el equipo). El botón manual sigue con `listEnrolled`, como siempre.
 */
export async function listEnrolledChecked(
  courseId: number,
): Promise<{ enrolled: TiendupEnrolled[]; complete: boolean }> {
  const key = process.env.TIENDUP_API_KEY;
  if (!key) return { enrolled: [], complete: false };
  const out: TiendupEnrolled[] = [];
  let complete = false;
  try {
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(
        `${baseUrl()}/learning/courses/${courseId}/enrolled?limit=100&page=${page}`,
        {
          headers: { "x-api-key": key, Accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!res.ok) break;
      const json = (await res.json()) as {
        data?: { name?: string; last_name?: string; email?: string }[];
        pages?: number;
      };
      const rows = json.data ?? [];
      for (const r of rows) {
        out.push({
          name: r.name ?? null,
          lastName: r.last_name ?? null,
          email: r.email ?? null,
        });
      }
      const pages = Number(json.pages ?? 1);
      if (page >= pages || rows.length === 0) {
        complete = true;
        break;
      }
    }
  } catch {
    // best-effort: si falla, devolvemos lo que juntamos.
  }
  return { enrolled: out, complete };
}

// --- Clientes de la tienda --------------------------------------------------

const customersCache = createCustomersCache();

/**
 * Listado COMPLETO de clientes de la tienda (solo GET, paginado en orden),
 * con cache en memoria compartida por el alta (botón y automática) y la ficha:
 * 10 min si vino completo, 1 min si no. `maxAgeMs` acota la edad aceptada
 * (0 = releer). Sin key → { ok:false, complete:false }. Nunca lanza.
 */
export async function listCustomersChecked(opts: { maxAgeMs?: number } = {}): Promise<CustomersListing> {
  return customersCache.get({
    maxAgeMs: opts.maxAgeMs,
    loader: () => fetchAllCustomers({ apiKey: process.env.TIENDUP_API_KEY, baseUrl: baseUrl() }),
  });
}

/**
 * Parte un nombre completo en nombre + apellido (heurística simple: primera
 * palabra = nombre, el resto = apellido). Para poblar el cliente en Tiendup.
 */
export function splitFullName(full: string | null | undefined): {
  name: string | null;
  lastName: string | null;
} {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { name: null, lastName: null };
  if (parts.length === 1) return { name: parts[0]!, lastName: null };
  return { name: parts[0]!, lastName: parts.slice(1).join(" ") };
}
