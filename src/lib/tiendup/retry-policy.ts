// ===========================================================================
// Cola de reintentos del alta en Tiendup: decisiones puras (sin DB ni red).
// La ejecución real vive en retry-pending.ts; esto lo testea
// scripts/test-tiendup-retry-queue.ts con datos inyectados.
//
// Qué entra: comprobantes esperando acceso, con correo válido y sin un motivo
// que necesite a una persona (mail que no figura, mismo nombre con otro correo,
// error no transitorio o reintentos ya agotados).
// ===========================================================================

import {
  isGaveUpError,
  isNameConflictError,
  isNotInTiendupError,
  parseRetryError,
  type RetryKind,
} from "./messages";
import { isTransientStoredError } from "./transient";

import { RETRY_GIVE_UP_MS, RETRY_MIN_INTERVAL_MS } from "./retry-timing";
export { RETRY_GIVE_UP_MS, RETRY_MIN_INTERVAL_MS } from "./retry-timing";
export const RETRY_DEFAULT_MAX = 8;
/**
 * Comprobantes SIN marcador RETRY_* solo entran si se crearon hace menos de
 * esto. Evita que el primer deploy de la cola recorra el backlog viejo (pagos
 * de octubre que el equipo resolvió por afuera de Tiendup sin marcarlos) y les
 * mande el aviso de acceso por WhatsApp semanas después. Los que ya tienen
 * marcador (fallaron con la cola activa) siguen hasta su tope de 24 h.
 */
export const RETRY_LOOKBACK_MS = 72 * 60 * 60_000;

export interface RetryRow {
  id: string;
  conversation_id: string | null;
  event_slug: string | null;
  status: string;
  awaiting_title: boolean;
  course_access_granted_at: string | null;
  course_access_error: string | null;
  updated_at: string;
  created_at: string;
}

export type RetryDecision =
  /** notify: false = pedido de "Enviar a Tiendup", no se avisa a la persona. */
  | { action: "retry"; mode: RetryKind; notify?: false }
  | { action: "give_up"; text: string }
  | { action: "wait" }
  | { action: "skip" };

export function decideRetry(args: {
  row: RetryRow;
  now: number;
  /** Criterio de "Falta acceso" + evento con curso mapeado. */
  waitsForAccess: boolean;
  hasValidEmail: boolean;
}): RetryDecision {
  const { row, now } = args;
  if (row.course_access_granted_at || !args.waitsForAccess || !args.hasValidEmail) return { action: "skip" };

  const error = row.course_access_error?.trim() || null;
  if (isNotInTiendupError(error) || isNameConflictError(error) || isGaveUpError(error)) {
    return { action: "skip" };
  }

  const marker = parseRetryError(error);
  if (!marker) {
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(created) || now - created > RETRY_LOOKBACK_MS) return { action: "skip" };
  }
  // Un error sin marcador solo entra si es transitorio (los viejos, previos a
  // la cola). No se sabe quién lo originó: va en automático, que no crea
  // clientes. Su plazo de 24 h arranca con el primer reintento que falle.
  if (!marker && error && !isTransientStoredError(error)) return { action: "skip" };

  if (marker?.firstFailedAt) {
    const first = Date.parse(marker.firstFailedAt);
    if (Number.isFinite(first) && now - first >= RETRY_GIVE_UP_MS) {
      return { action: "give_up", text: marker.text };
    }
  }

  const last = Date.parse(row.updated_at);
  if (!Number.isFinite(last) || now - last < RETRY_MIN_INTERVAL_MS) return { action: "wait" };
  return {
    action: "retry",
    mode: marker?.kind ?? "auto",
    ...(marker?.silent ? { notify: false as const } : {}),
  };
}

export interface RetryPlan {
  /** Pedidos manuales primero; después, el que hace más que no se intenta. */
  retry: { row: RetryRow; mode: RetryKind; notify?: false }[];
  giveUp: { row: RetryRow; text: string }[];
  /** En cola pero todavía dentro de la espera entre intentos. */
  waiting: number;
}

export function planRetries(
  rows: readonly RetryRow[],
  args: {
    now: number;
    waitsForAccess: (row: RetryRow) => boolean;
    hasValidEmail: (row: RetryRow) => boolean;
  },
): RetryPlan {
  const plan: RetryPlan = { retry: [], giveUp: [], waiting: 0 };
  for (const row of rows) {
    const d = decideRetry({
      row,
      now: args.now,
      waitsForAccess: args.waitsForAccess(row),
      hasValidEmail: args.hasValidEmail(row),
    });
    if (d.action === "retry") {
      plan.retry.push({ row, mode: d.mode, ...(d.notify === false ? { notify: false as const } : {}) });
    }
    else if (d.action === "give_up") plan.giveUp.push({ row, text: d.text });
    else if (d.action === "wait") plan.waiting++;
  }
  plan.retry.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "manual" ? -1 : 1;
    return Date.parse(a.row.updated_at) - Date.parse(b.row.updated_at);
  });
  return plan;
}

/**
 * Resultado de un intento:
 *   - ok: quedó el acceso;
 *   - transient: Tiendup no respondió (corta la corrida);
 *   - failed: falló por algo propio de este caso (sigue con el próximo);
 *   - skipped: otro proceso lo tomó primero (no cuenta como intento).
 */
export type RetryAttemptResult = "ok" | "transient" | "failed" | "skipped";

/** Traduce el resultado del alta. Los listados caídos cuentan como transitorios. */
export function retryResultOf(o: { kind: string; transient?: boolean }): RetryAttemptResult {
  if (o.kind === "enrolled" || o.kind === "already_enrolled") return "ok";
  if (o.kind === "listing_failed" || o.kind === "customer_check_failed") return "transient";
  if (o.kind === "enroll_failed" && o.transient) return "transient";
  return "failed";
}

export interface RetryRunSummary {
  attempted: number;
  ok: number;
  /** Siguen en cola al terminar la corrida. */
  pending: number;
  /** Se cortó porque Tiendup no respondió. */
  tripped: boolean;
}

/**
 * Corre el plan en secuencia, hasta `max` intentos. Circuit breaker: al primer
 * fallo transitorio corta, porque Tiendup está caído o limitando y seguir solo
 * lo empeora. El próximo cron retoma.
 */
export async function runRetryPlan<T>(args: {
  items: readonly T[];
  max: number;
  attempt: (item: T) => Promise<RetryAttemptResult>;
  /** true = no arrancar otro intento (presupuesto de tiempo de la corrida). */
  shouldStop?: () => boolean;
  waiting?: number;
}): Promise<RetryRunSummary> {
  let attempted = 0;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let tripped = false;
  for (const item of args.items) {
    if (attempted >= args.max || args.shouldStop?.()) break;
    const result = await args.attempt(item);
    if (result === "skipped") {
      skipped++;
      continue;
    }
    attempted++;
    if (result === "ok") ok++;
    else if (result === "failed") failed++;
    else {
      tripped = true;
      break;
    }
  }
  // Los "failed" salen de la cola (quedan para el equipo); los tomados por otro
  // proceso los cuenta esa corrida.
  const pending = args.items.length - ok - failed - skipped + (args.waiting ?? 0);
  return { attempted, ok, pending, tripped };
}
