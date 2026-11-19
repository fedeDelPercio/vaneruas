// Lógica pura de /metrics: ventanas por día en hora de Argentina, series
// diarias, tasa de automatización, variación contra el período anterior y la
// serie de aprobaciones del equipo. Sin red ni Supabase, para poder testearla
// (scripts/test-metrics-series.ts).

import { esAgrupado, esCierreMasivo, esDescartado } from "@/lib/payments/dismiss";
import { groupPendingPayments } from "@/lib/payments/grouping";

// Argentina es UTC-3 todo el año: el día "del negocio" arranca a las 03:00 UTC.
const AR_OFFSET_MS = 3 * 3_600_000;
export const DAY_MS = 86_400_000;

/** Fecha YYYY-MM-DD en hora de Argentina. */
export function arDay(d: Date): string {
  return new Date(d.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}
/** Instante UTC (ISO) del arranque de ese día en Argentina. */
export function arStart(day: string): string {
  return `${day}T03:00:00.000Z`;
}
/** Suma `n` días a una fecha YYYY-MM-DD. */
export function shiftDay(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export interface MetricWindow {
  /** Días (YYYY-MM-DD, hora AR) del período actual, del más viejo a hoy. */
  keys: string[];
  /** Arranque del período actual (ISO). */
  since: string;
  /** Arranque del período anterior, de igual largo (ISO). Termina en `since`. */
  prevSince: string;
}

/**
 * Período de `days` días que termina hoy (hora AR), alineado a días enteros:
 * "7 días" = hoy + los 6 días anteriores. El anterior son los `days` días
 * inmediatamente previos. Hoy va parcial en ambos lados de la comparación de la
 * misma forma que en Hábitat.
 */
export function metricWindow(days: number, now = new Date()): MetricWindow {
  const today = arDay(now);
  const first = shiftDay(today, 1 - days);
  const keys = Array.from({ length: days }, (_, i) => shiftDay(first, i));
  return { keys, since: arStart(first), prevSince: arStart(shiftDay(first, -days)) };
}

/** ¿El timestamp cae en [desde, hasta)? Comparación por instante, no por string. */
export function inRange(ts: string, desde: string, hasta?: string): boolean {
  const t = new Date(ts).getTime();
  return t >= new Date(desde).getTime() && (hasta === undefined || t < new Date(hasta).getTime());
}

/** Conteo por día (hora AR) alineado a `keys`. Lo que cae fuera se ignora. */
export function countByDay(timestamps: string[], keys: string[]): number[] {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  for (const t of timestamps) {
    const i = idx.get(arDay(new Date(t)));
    if (i !== undefined) out[i]!++;
  }
  return out;
}

/** % de mensajes de IA sobre IA + equipo, con un decimal. null sin salientes. */
export function automationRate(ai: number, human: number): number | null {
  return ai + human === 0 ? null : Math.round((ai / (ai + human)) * 1000) / 10;
}

/**
 * Tasa de automatización por día. Un día anterior a `coberturaDesde` (desde
 * cuándo se registran los mensajes del equipo) va como null: ahí el 100% de IA
 * sería un artefacto del registro, no un dato.
 */
export function rateByDay(
  aiTs: string[],
  humanTs: string[],
  keys: string[],
  coberturaDesde: number | null,
): (number | null)[] {
  const ai = countByDay(aiTs, keys);
  const human = countByDay(humanTs, keys);
  return keys.map((k, i) => {
    if (coberturaDesde === null || new Date(arStart(k)).getTime() < coberturaDesde) return null;
    return automationRate(ai[i]!, human[i]!);
  });
}

/** Promedio por día de `ms`, agrupado por el día de `at`. null sin datos. */
export function avgByDay(rows: { at: string; ms: number }[], keys: string[]): (number | null)[] {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const sum = keys.map(() => 0);
  const n = keys.map(() => 0);
  for (const r of rows) {
    const i = idx.get(arDay(new Date(r.at)));
    if (i === undefined) continue;
    sum[i]! += r.ms;
    n[i]!++;
  }
  return keys.map((_, i) => (n[i] ? Math.round(sum[i]! / n[i]!) : null));
}

/** Promedio simple. null si no hay valores. */
export function average(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

// Variación relativa en %, con un decimal (misma regla que Hábitat). Base 0
// solo admite "sin cambio" si el actual también es 0; si no, no hay dato.
export function relativeDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export interface KpiPoint {
  /** Día YYYY-MM-DD (hora AR). */
  label: string;
  value: number | null;
}

/** Titular de una tarjeta KPI: total, comparación y serie diaria. */
export interface KpiData {
  total: number | null;
  /** Total del período anterior de igual largo. null si no hay dato honesto. */
  previousTotal: number | null;
  /** Variación % contra el anterior. null si no se puede calcular. */
  delta: number | null;
  series: KpiPoint[];
}

export function buildKpi(
  total: number | null,
  previousTotal: number | null,
  keys: string[],
  values: (number | null)[],
): KpiData {
  return {
    total,
    previousTotal,
    delta: relativeDelta(total, previousTotal),
    series: keys.map((label, i) => ({ label, value: values[i] ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Comprobantes recibidos.

export interface MetricsPaymentRow {
  id: string;
  conversation_id: string | null;
  event_slug: string | null;
  operation_number: string | null;
  created_at: string;
  status: string;
  validation_note: string | null;
  amount: number | string | null;
}

/**
 * Instantes de llegada de los comprobantes que cuentan como recibidos: sin
 * imágenes agrupadas, sin descartados (no eran un comprobante) y sin el cierre
 * masivo. Los pendientes cuentan una vez por grupo (por su canónico). Es el
 * mismo número que "recibidos − descartados" del embudo.
 */
export function comprobantesRecibidos(rows: MetricsPaymentRow[]): string[] {
  const counted = rows.filter((r) => !esAgrupado(r) && !esCierreMasivo(r));
  const pendientes = groupPendingPayments(counted.filter((r) => r.status === "pending"));
  return [
    ...pendientes.map((g) => g.canonical.created_at),
    ...counted.filter((r) => r.status !== "pending" && !esDescartado(r)).map((r) => r.created_at),
  ];
}

// ---------------------------------------------------------------------------
// Aprobaciones realizadas por el equipo, día a día.

export interface ApprovalPaymentRow {
  status: string;
  validated_at: string | null;
  validation_note: string | null;
}
export interface ApprovalTitleRow {
  reviewed_at: string | null;
  validation_note: string | null;
}
export interface ApprovalDay {
  date: string;
  comprobantesValidados: number;
  /** Rechazados y descartados (ambos son una revisión del equipo). */
  comprobantesRechazados: number;
  titulos: number;
}

/** ¿Este comprobante cuenta como una revisión hecha por el equipo? */
export function esRevisionDeComprobante(r: ApprovalPaymentRow): boolean {
  if (r.status !== "validated" && r.status !== "rejected") return false;
  if (!r.validated_at) return false;
  // Las imágenes agrupadas son el mismo pago que su canónico (ya contado) y el
  // cierre masivo no fue una revisión hecha en el panel.
  return !esAgrupado(r) && !esCierreMasivo(r);
}

export function buildApprovalsDaily(
  payments: ApprovalPaymentRow[],
  titles: ApprovalTitleRow[],
  keys: string[],
): ApprovalDay[] {
  const revisados = payments.filter(esRevisionDeComprobante);
  const validados = countByDay(
    revisados.filter((r) => r.status === "validated").map((r) => r.validated_at!),
    keys,
  );
  const rechazados = countByDay(
    revisados.filter((r) => r.status === "rejected").map((r) => r.validated_at!),
    keys,
  );
  const titulos = countByDay(
    titles.filter((t) => t.reviewed_at && !esCierreMasivo(t)).map((t) => t.reviewed_at!),
    keys,
  );
  return keys.map((date, i) => ({
    date,
    comprobantesValidados: validados[i]!,
    comprobantesRechazados: rechazados[i]!,
    titulos: titulos[i]!,
  }));
}

// Puntos de la mini tendencia (copiado de atp-habitat, lib/dashboard-charts):
// la serie del período tal cual, sin rellenar con 0 los huecos de tasas. Con
// menos de dos puntos reales no hay tendencia que mostrar.
export function sparklineValues(chart: Pick<KpiData, "series">): (number | null)[] | null {
  const values = chart.series.map((point) => point.value);
  return values.filter((value) => value !== null).length >= 2 ? values : null;
}
