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

// --- Chequeo previo: ¿ya está inscripta? ----------------------------------
//
// CRÍTICO: el mail que capturamos por WhatsApp NO es confiable (typos, mails
// truncados, o la persona da un mail distinto al de su cuenta de Tiendup). Si
// inscribimos con un mail equivocado, Tiendup CREA un cliente nuevo con ese mail
// basura y la persona real sigue sin acceso. Por eso, antes de inscribir,
// buscamos si ya está en el curso (por mail o por NOMBRE) y avisamos.

export interface TiendupEnrolled {
  name: string | null;
  lastName: string | null;
  email: string | null;
}

/** normaliza para comparar: minúsculas, sin acentos, solo alfanumérico. */
function normLoose(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Trae TODOS los inscriptos al curso (paginado). [] ante error. */
export async function listEnrolled(courseId: number): Promise<TiendupEnrolled[]> {
  const key = process.env.TIENDUP_API_KEY;
  if (!key) return [];
  const out: TiendupEnrolled[] = [];
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
      if (page >= pages || rows.length === 0) break;
    }
  } catch {
    // best-effort: si falla, devolvemos lo que juntamos.
  }
  return out;
}

export interface ExistingEnrollment {
  /** "email" = coincide el mail; "nombre" = coincide la persona pero con OTRO mail. */
  matchedBy: "email" | "nombre";
  enrolled: TiendupEnrolled;
}

/**
 * ¿Esta persona ya está inscripta en el curso? Busca por mail (exacto, y también
 * "limpiando" basura al principio, ej. "_mail@x.com") y, si no, por NOMBRE
 * (todos los tokens del nombre presentes en el inscripto). Devuelve el match, o
 * null si no aparece.
 */
export function findExistingEnrollment(args: {
  enrolled: TiendupEnrolled[];
  email: string;
  fullName?: string | null;
}): ExistingEnrollment | null {
  const emailNorm = normLoose(args.email);
  // a) match por mail (normLoose saca guiones bajos/puntos, así que cubre los
  //    mails mal capturados tipo "_florencia...@gmail.com").
  const byEmail = args.enrolled.find((e) => e.email && normLoose(e.email) === emailNorm);
  if (byEmail) return { matchedBy: "email", enrolled: byEmail };

  // b) match por nombre: todos los tokens significativos del nombre tienen que
  //    estar en el nombre+apellido del inscripto.
  const tokens = (args.fullName ?? "")
    .split(/\s+/)
    .map(normLoose)
    .filter((t) => t.length > 3);
  if (tokens.length >= 2) {
    const byName = args.enrolled.find((e) => {
      const full = normLoose(`${e.name ?? ""}${e.lastName ?? ""}`);
      return tokens.every((t) => full.includes(t));
    });
    if (byName) return { matchedBy: "nombre", enrolled: byName };
  }
  return null;
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
