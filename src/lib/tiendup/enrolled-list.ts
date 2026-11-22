// ===========================================================================
// Listado de inscriptos a un curso (GET /learning/courses/{id}/enrolled),
// página por página y con reintento por página ante fallos transitorios.
//
// `complete` solo es true si se llegó a la última página: con un listado
// cortado no se puede afirmar que alguien no está inscripto.
//
// Puro y sin "server-only" (fetch inyectable): client.ts lo envuelve y
// scripts/test-tiendup-retry-queue.ts lo testea sin red.
// ===========================================================================

import type { TiendupEnrolled } from "./match";
import { fetchPageWithRetry, type FetchLike } from "./transient";

const MAX_PAGES = 50;

export async function fetchAllEnrolled(args: {
  apiKey: string;
  baseUrl: string;
  courseId: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  deadlineAt?: number;
  now?: () => number;
}): Promise<{ enrolled: TiendupEnrolled[]; complete: boolean }> {
  const out: TiendupEnrolled[] = [];
  let complete = false;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetchPageWithRetry({
        url: `${args.baseUrl}/learning/courses/${args.courseId}/enrolled?limit=100&page=${page}`,
        apiKey: args.apiKey,
        timeoutMs: args.timeoutMs,
        fetchImpl: args.fetchImpl,
        sleep: args.sleep,
        delaysMs: args.retryDelaysMs,
        deadlineAt: args.deadlineAt,
        now: args.now,
      });
      if (!res) break;
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
    // best-effort: si falla, devolvemos lo que juntamos (complete queda false).
  }
  return { enrolled: out, complete };
}
