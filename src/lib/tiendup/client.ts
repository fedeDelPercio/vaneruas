import "server-only";

// ===========================================================================
// Cliente de la API pública de Tiendup (entrega de acceso a cursos).
//
// Conexión: host por-negocio `https://<slug>.public-api.tiendup.com`, auth por
// header `x-api-key`. La key vive en `TIENDUP_API_KEY` (server-only). El host se
// puede override con `TIENDUP_BASE_URL`.
//
// Enroll confirmado en vivo:
//   POST /learning/courses/{courseId}/enroll
//   body: { customer: { email, name?, last_name? }, enrollment_type: "paid" }
//   → crea el cliente en Tiendup si no existe + lo inscribe. Idempotente.
// ===========================================================================

const DEFAULT_BASE_URL = "https://vanesaruas.public-api.tiendup.com";
const TIMEOUT_MS = 20000;

// Mapeo evento (event_slug de payment_validations) → id de curso en Tiendup.
// Por ahora la única masterclass con curso es "Higiene Facial + Dermaplaning".
const TIENDUP_COURSE_BY_EVENT_SLUG: Record<string, number> = {
  "masterclass-higiene-facial-dermaplaning": 519060,
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
