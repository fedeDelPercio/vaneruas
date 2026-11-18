// ===========================================================================
// Clientes de la tienda en Tiendup (GET /customers), para saber si un correo
// ya existe como CLIENTE antes de inscribirlo a un curso.
//
// Por qué: POST /learning/courses/{id}/enroll crea el cliente si no existe. Si
// el correo que capturamos por WhatsApp está mal (typo, otro correo), Tiendup
// crea un cliente basura y la persona real se queda sin acceso. Quien paga
// por transferencia normalmente ya se registró en la web (checkout de Tiendup)
// aunque todavía no esté inscripta en el curso: por eso el criterio es "existe
// como cliente de la tienda", no "figura en el curso".
//
// Tiendup NO tiene búsqueda de cliente por correo: hay que recorrer el listado
// paginado completo, GET /customers?page=N&limit=M →
//   { status, data:[{id,name,last_name,email,phone}], countFiltered, count,
//     previous, current, pages, next }
// El límite máximo no está documentado: pedimos 100 y toleramos que devuelva
// menos (se pagina por `pages` / `next`, no por el tamaño pedido).
//
// Puro y sin "server-only" (fetch inyectable): lo testea
// scripts/test-tiendup-customers.ts sin red. client.ts lo re-exporta.
// ===========================================================================

export interface TiendupCustomer {
  id: string | null;
  name: string | null;
  lastName: string | null;
  email: string | null;
}

export interface CustomersListing {
  /** false = alguna página falló (HTTP, red, JSON) o no hay key. */
  ok: boolean;
  /** true = se recorrieron todas las páginas y el total cierra. Solo así se puede afirmar "no existe". */
  complete: boolean;
  customers: TiendupCustomer[];
  /** Cuándo se leyó (ms epoch). Para decidir si vale la pena releer. */
  fetchedAt: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PAGE_LIMIT = 100;
// Tope de páginas: aun si Tiendup capara el límite a 25, cubre 10.000 clientes.
// Si se llega al tope sin terminar, el listado queda incompleto (no se afirma
// que un correo no existe).
const MAX_PAGES = 400;
const TIMEOUT_MS = 20000;

/** Normaliza un correo para comparar: trim + minúsculas. Nada más (ver findCustomerByEmail). */
export function normalizeEmailForMatch(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Busca un cliente por correo. Comparación ESTRICTA (trim + minúsculas): a
 * diferencia del match contra inscriptos (que tolera basura), acá un match
 * "aproximado" sería peligroso, porque el enroll se hace con NUESTRO correo y,
 * si no es exactamente el del cliente, Tiendup crea uno nuevo igual.
 */
export function findCustomerByEmail(
  customers: TiendupCustomer[],
  email: string | null | undefined,
): TiendupCustomer | null {
  const target = normalizeEmailForMatch(email);
  if (!target) return null;
  return customers.find((c) => normalizeEmailForMatch(c.email) === target) ?? null;
}

/** Número tolerante: acepta number o string numérico ("12"); si no, null. */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Lee TODO el listado de clientes, página por página EN ORDEN (secuencial,
 * page=1,2,3…; nunca en paralelo, para que el orden sea estable y una página
 * no se pise con otra). Nunca lanza.
 *
 * `complete` exige:
 *   - todas las respuestas 2xx con JSON parseable;
 *   - haber llegado a la última página (`current >= pages`, `next` vacío o una
 *     página sin filas);
 *   - si Tiendup informó el total (`countFiltered` / `count`, number o string),
 *     haber juntado al menos esa cantidad de clientes distintos. Si alguien se
 *     registra mientras paginamos, el corrimiento puede duplicar o saltear
 *     filas: en ese caso queda incompleto y se reintenta después.
 * Los duplicados (mismo id, o mismo correo sin id) se descartan.
 */
export async function fetchAllCustomers(args: {
  apiKey: string | null | undefined;
  baseUrl: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<CustomersListing> {
  const now = args.now ?? Date.now;
  const fetchImpl: FetchLike = args.fetchImpl ?? ((i, init) => fetch(i, init));
  if (!args.apiKey) return { ok: false, complete: false, customers: [], fetchedAt: now() };

  const out: TiendupCustomer[] = [];
  const seen = new Set<string>();
  let ok = true;
  let reachedEnd = false;
  let expectedTotal: number | null = null;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetchImpl(`${args.baseUrl}/customers?limit=${PAGE_LIMIT}&page=${page}`, {
        headers: { "x-api-key": args.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        ok = false;
        break;
      }
      const json = (await res.json()) as Record<string, unknown> | null;
      if (!json || typeof json !== "object") {
        ok = false;
        break;
      }
      if (json.status !== undefined && json.status !== "OK" && json.status !== "ok") {
        ok = false;
        break;
      }
      const rows = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : null;
      if (!rows) {
        ok = false;
        break;
      }
      if (page === 1) expectedTotal = num(json.countFiltered) ?? num(json.count);

      for (const r of rows) {
        if (!r || typeof r !== "object") continue;
        const c: TiendupCustomer = {
          id: str(r.id),
          name: str(r.name),
          lastName: str(r.last_name),
          email: str(r.email),
        };
        const key = c.id ? `id:${c.id}` : `email:${normalizeEmailForMatch(c.email)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
      }

      const pages = num(json.pages);
      const current = num(json.current) ?? page;
      const hasNext = json.next !== undefined && json.next !== null && json.next !== "" && json.next !== false;
      if (rows.length === 0) {
        reachedEnd = true;
        break;
      }
      if (pages !== null) {
        if (current >= pages) {
          reachedEnd = true;
          break;
        }
      } else if (!hasNext) {
        // Sin `pages`: manda `next`.
        reachedEnd = true;
        break;
      }
    }
  } catch {
    ok = false;
  }

  const totalOk = expectedTotal === null || out.length >= expectedTotal;
  return { ok, complete: ok && reachedEnd && totalOk, customers: out, fetchedAt: now() };
}

// --- Cache en memoria ------------------------------------------------------
//
// Una sola cache para el alta (botón y automática) y la ficha: el listado de
// clientes es grande (muchas páginas) y casi no cambia. 10 min si vino
// completo; 1 min si vino incompleto (reintentar pronto sin martillar). Vive
// por instancia (en Vercel cada lambda tiene la suya). Las lecturas
// simultáneas comparten el mismo request.

export const CUSTOMERS_TTL_OK_MS = 10 * 60_000;
export const CUSTOMERS_TTL_FAIL_MS = 60_000;

export interface CustomersCache {
  get(opts: {
    loader: () => Promise<CustomersListing>;
    /** Edad máxima aceptada del cache (default: el TTL). 0 = releer sí o sí. */
    maxAgeMs?: number;
  }): Promise<CustomersListing>;
  clear(): void;
}

export function createCustomersCache(now: () => number = Date.now): CustomersCache {
  let entry: CustomersListing | null = null;
  let inflight: Promise<CustomersListing> | null = null;
  return {
    async get({ loader, maxAgeMs }) {
      if (entry) {
        const ttl = entry.complete ? CUSTOMERS_TTL_OK_MS : CUSTOMERS_TTL_FAIL_MS;
        const limit = Math.min(ttl, maxAgeMs ?? ttl);
        if (now() - entry.fetchedAt < limit) return entry;
      }
      if (inflight) return inflight;
      const p = loader()
        .then((value) => {
          entry = value;
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      inflight = p;
      return p;
    },
    clear() {
      entry = null;
      inflight = null;
    },
  };
}
