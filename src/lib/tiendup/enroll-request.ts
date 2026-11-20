// ===========================================================================
// POST de alta a Tiendup con reintentos para errores transitorios.
//
// El 20/11/2026 entre 16:07 y 16:15 dos altas fallaron con
// "Tiendup 403: <div>site not found</div>" mientras otras del mismo rato
// salían bien: Tiendup a veces responde así unos minutos. El enroll es
// idempotente (si ya está inscripta devuelve OK), así que reintentar es
// seguro.
//
// Se reintenta (por defecto 2 veces, a los 1,5 s y 4 s):
//   - 403 con "site not found" (el 403 transitorio de Tiendup);
//   - 429 y 5xx;
//   - error de red o timeout (fetch lanza).
// NO se reintentan los demás 4xx (validación, key inválida, curso que no
// existe): repetirlos no cambia nada.
//
// Puro (fetch y espera inyectables) y sin "server-only": lo usa client.ts y
// lo testea scripts/test-tiendup-enroll-retry.ts sin red.
// ===========================================================================

import { tidyTiendupError } from "./messages";

export const ENROLL_RETRY_DELAYS_MS = [1500, 4000] as const;

export interface EnrollRequestResult {
  ok: boolean;
  error?: string;
  /** Intentos hechos (1 = sin reintentos). */
  attempts: number;
}

/** ¿Una respuesta HTTP fallida de Tiendup vale la pena reintentarla? */
export function isRetryableTiendupResponse(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 403 && /site not found/i.test(body);
}

export async function postEnrollWithRetry(args: {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
}): Promise<EnrollRequestResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = args.delaysMs ?? ENROLL_RETRY_DELAYS_MS;

  let lastError = "error desconocido";
  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    if (attempt > 1) await sleep(delays[attempt - 2]!);
    let res: Response;
    try {
      res = await doFetch(args.url, {
        method: "POST",
        headers: {
          "x-api-key": args.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(args.body),
        signal: AbortSignal.timeout(args.timeoutMs),
      });
    } catch (err) {
      // Red caída o timeout: transitorio.
      const msg = err instanceof Error ? err.message : String(err);
      lastError = tidyTiendupError(`Tiendup sin respuesta: ${msg}`);
      continue;
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      lastError = tidyTiendupError(`Tiendup ${res.status}: ${text}`);
      if (isRetryableTiendupResponse(res.status, text)) continue;
      return { ok: false, error: lastError, attempts: attempt };
    }
    // Respuesta esperada: {"status":"OK"}.
    try {
      const json = JSON.parse(text) as { status?: string };
      if (json.status && json.status !== "OK") {
        return { ok: false, error: `Tiendup respondió status ${json.status}`, attempts: attempt };
      }
    } catch {
      // Sin JSON parseable pero 2xx: lo damos por OK.
    }
    return { ok: true, attempts: attempt };
  }
  return { ok: false, error: lastError, attempts: delays.length + 1 };
}
