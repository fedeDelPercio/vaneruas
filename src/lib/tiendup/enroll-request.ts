// ===========================================================================
// POST de alta a Tiendup con reintentos para errores transitorios.
//
// El 20/11/2026 entre 16:07 y 16:15 dos altas fallaron con
// "Tiendup 403: <div>site not found</div>" mientras otras del mismo rato
// salían bien: Tiendup a veces responde así unos minutos. El enroll es
// idempotente (si ya está inscripta devuelve OK), así que reintentar es
// seguro.
//
// Se reintenta (por defecto 3 veces, a los 2 s, 5 s y 10 s) lo transitorio
// (transient.ts): 403 "site not found", 429, 5xx, red o timeout. Los demás 4xx
// no. Con `deadlineAt` ningún intento se pasa de ese instante: el camino inline
// tiene que terminar bien antes del límite de 60 s de la función. Lo que siga
// fallando lo retoma la cola (retry-pending.ts).
//
// Puro (fetch y espera inyectables) y sin "server-only": lo usa client.ts y
// lo testea scripts/test-tiendup-enroll-retry.ts sin red.
// ===========================================================================

import { tidyTiendupError } from "./messages";
import { MIN_REQUEST_MS, defaultSleep, isTransientTiendupResponse } from "./transient";

export const ENROLL_RETRY_DELAYS_MS = [2000, 5000, 10000] as const;

export interface EnrollRequestResult {
  ok: boolean;
  error?: string;
  /** Intentos hechos (1 = sin reintentos). */
  attempts: number;
  /** El fallo fue transitorio: tiene sentido volver a intentar más tarde. */
  transient?: boolean;
}

/** ¿Una respuesta HTTP fallida de Tiendup vale la pena reintentarla? */
export const isRetryableTiendupResponse = isTransientTiendupResponse;

export async function postEnrollWithRetry(args: {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
  /** Instante (ms epoch) que ningún intento puede pasar. */
  deadlineAt?: number;
  now?: () => number;
}): Promise<EnrollRequestResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const sleep = args.sleep ?? defaultSleep;
  const delays = args.delaysMs ?? ENROLL_RETRY_DELAYS_MS;
  const now = args.now ?? Date.now;

  let lastError = "Tiendup sin respuesta: se agotó el tiempo";
  let made = 0;
  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    if (attempt > 1) {
      const delay = delays[attempt - 2]!;
      if (args.deadlineAt !== undefined && now() + delay + MIN_REQUEST_MS > args.deadlineAt) break;
      await sleep(delay);
    }
    const remaining = args.deadlineAt === undefined ? args.timeoutMs : args.deadlineAt - now();
    if (remaining < MIN_REQUEST_MS) break;
    made = attempt;
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
        signal: AbortSignal.timeout(Math.min(args.timeoutMs, remaining)),
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
      if (isTransientTiendupResponse(res.status, text)) continue;
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
  return { ok: false, error: lastError, attempts: made, transient: true };
}
