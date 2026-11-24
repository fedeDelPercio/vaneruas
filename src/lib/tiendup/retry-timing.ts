/** Tiempo mínimo entre intentos del mismo comprobante. */
export const RETRY_MIN_INTERVAL_MS = 2 * 60_000;
/** Tiempo máximo desde el primer fallo registrado. */
export const RETRY_GIVE_UP_MS = 24 * 60 * 60_000;

export const RETRY_INTERVAL_MINUTES = RETRY_MIN_INTERVAL_MS / 60_000;
export const RETRY_DURATION_HOURS = RETRY_GIVE_UP_MS / 3_600_000;
