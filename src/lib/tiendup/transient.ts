// ===========================================================================
// Errores transitorios de Tiendup y GET con reintento por página.
//
// Tiendup a veces responde varios minutos seguidos 403 con el HTML
// "<div>site not found</div>" (incidente 22/11/2026). Son transitorios:
//   - 403 con "site not found";
//   - 429 y 5xx;
//   - error de red o timeout (fetch lanza).
// Los demás 4xx (validación, key inválida, curso inexistente) no: repetirlos no
// cambia nada.
//
// Puro (fetch, espera y reloj inyectables) y sin "server-only": lo testea
// scripts/test-tiendup-retry-queue.ts sin red.
// ===========================================================================

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Esperas entre intentos de una misma página de un listado. */
export const PAGE_RETRY_DELAYS_MS = [1000, 3000] as const;

/** Con menos margen que esto hasta el deadline no se arranca otro request. */
export const MIN_REQUEST_MS = 1000;

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** ¿Una respuesta HTTP fallida de Tiendup es transitoria? */
export function isTransientTiendupResponse(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 403 && /site not found/i.test(body);
}

/**
 * ¿Un course_access_error guardado SIN marcador describe un fallo transitorio?
 * Cubre los errores viejos, previos a la cola (crudos o ya prolijos). Un
 * "Tiendup no respondió (404 …)" no cuenta: tidyTiendupError usa ese texto para
 * cualquier cuerpo HTML.
 */
export function isTransientStoredError(error: string | null | undefined): boolean {
  const e = error?.trim();
  if (!e) return false;
  if (/^Tiendup sin respuesta\b/i.test(e)) return true;
  const tidy = /^Tiendup no respondió \((\d{3})\b([^)]*)\)/i.exec(e);
  const raw = /^Tiendup (\d{3}):\s*([\s\S]*)$/.exec(e);
  const m = tidy ?? raw;
  return m ? isTransientTiendupResponse(Number(m[1]), m[2] ?? "") : false;
}

/**
 * GET de una página con reintentos ante fallos transitorios. Devuelve la
 * respuesta 2xx, o null si falló (no lanza). Con `deadlineAt` ningún request
 * se pasa de ese instante y no se arranca un reintento que no entre.
 */
export async function fetchPageWithRetry(args: {
  url: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
  deadlineAt?: number;
  now?: () => number;
}): Promise<Response | null> {
  const doFetch: FetchLike = args.fetchImpl ?? ((i, init) => fetch(i, init));
  const sleep = args.sleep ?? defaultSleep;
  const delays = args.delaysMs ?? PAGE_RETRY_DELAYS_MS;
  const now = args.now ?? Date.now;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      const delay = delays[attempt - 1]!;
      if (args.deadlineAt !== undefined && now() + delay + MIN_REQUEST_MS > args.deadlineAt) return null;
      await sleep(delay);
    }
    const remaining = args.deadlineAt === undefined ? args.timeoutMs : args.deadlineAt - now();
    if (remaining < MIN_REQUEST_MS) return null;
    try {
      const res = await doFetch(args.url, {
        headers: { "x-api-key": args.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(args.timeoutMs, remaining)),
      });
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      if (!isTransientTiendupResponse(res.status, body)) return null;
    } catch {
      // Red caída o timeout: transitorio, sigue con el próximo intento.
    }
  }
  return null;
}
