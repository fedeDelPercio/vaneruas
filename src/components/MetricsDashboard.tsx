"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, Minus, Plus } from "lucide-react";
import type { MetricsResponse } from "@/app/api/metrics/route";
import { DailyActivityChart } from "./DailyActivityChart";
import { PaymentDonut } from "./PaymentDonut";
import { CategoryBarChart } from "./CategoryBarChart";

// Dashboard de métricas del cliente. Lee /api/metrics y presenta:
//  - mensajes respondidos por IA vs humano,
//  - embudo de comprobantes + tiempo medio de validación,
//  - backlog de comprobantes pendientes por días hábiles (umbral ajustable),
//  - derivaciones por categoría.
// Estética refined minimal: números mono, barras neutras, acentos solo como
// texto/dot (ok/warn/red), sin charts de colores.

type PeriodKey = "7d" | "30d" | "90d" | "all";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "90d", label: "90 días" },
  { key: "all", label: "Todo" },
];

const BACKLOG_KEY = "atp.backlogThresholdDays";

// Etiquetas humanas para las categorías de derivación. Fallback: humaniza el
// snake_case (igual criterio que el email del equipo).
const CATEGORY_LABELS: Record<string, string> = {
  validacion_pago: "Comprobante de pago",
  interes_compra: "Interés de compra",
  cliente_existente: "Cliente existente",
  fuera_de_conocimiento: "Fuera de conocimiento",
  escalado_manual: "Escalado manual",
  visita_obra: "Pedido de visita",
  consulta_financiacion: "Consulta de financiación",
};

function categoryLabel(c: string): string {
  if (CATEGORY_LABELS[c]) return CATEGORY_LABELS[c];
  return c
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Días hábiles (lun-vie) transcurridos entre dos fechas, ignorando la hora. */
function businessDaysElapsed(start: Date, end: Date): number {
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  let count = 0;
  const cur = new Date(s);
  while (cur < e) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function fmtDuration(ms: number | null): { value: string; unit: string } {
  if (ms === null) return { value: "—", unit: "" };
  const hours = ms / 3_600_000;
  if (hours < 1) return { value: String(Math.round(ms / 60_000)), unit: "min" };
  if (hours < 24) return { value: hours.toFixed(1).replace(".", ","), unit: "h" };
  return { value: (hours / 24).toFixed(1).replace(".", ","), unit: "días" };
}

function fmtAmount(amount: number | null): string {
  if (amount === null) return "—";
  return `ARS ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0 }).format(amount)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function MetricsDashboard() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(2);

  // Umbral de backlog persistido en localStorage (default 2 días hábiles).
  useEffect(() => {
    const raw = window.localStorage.getItem(BACKLOG_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n >= 0) setThreshold(n);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(BACKLOG_KEY, String(threshold));
  }, [threshold]);

  const load = useCallback(async (p: PeriodKey) => {
    try {
      const r = await fetch(`/api/metrics?period=${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar las métricas");
        return;
      }
      setError(null);
      setData(j as MetricsResponse);
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    setData(null);
    void load(period);
  }, [period, load]);

  // Backlog: pendientes con >= threshold días hábiles desde la recepción.
  const overdue = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    return data.pending
      .map((p) => ({ ...p, businessDays: businessDaysElapsed(new Date(p.createdAt), now) }))
      .filter((p) => p.businessDays >= threshold)
      .sort((a, b) => b.businessDays - a.businessDays);
  }, [data, threshold]);

  const aiPct = data?.containment.pctAI ?? null;

  const approvalPct = useMemo(() => {
    if (!data) return null;
    const { validated, rejected } = data.paymentFunnel;
    const resolved = validated + rejected;
    return resolved === 0 ? null : Math.round((validated / resolved) * 100);
  }, [data]);

  if (error && data === null) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-500">
        {error}
      </div>
    );
  }

  const dur = data ? fmtDuration(data.validation.avgMs) : { value: "—", unit: "" };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <h1 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          Métricas
        </h1>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-2.5 py-1.5 text-[12px] transition ${
                period === p.key
                  ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {data === null ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-neutral-500 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          Cargando métricas…
        </div>
      ) : (
        <div className="space-y-3">
          {/* Fila de stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Respondido por IA"
              value={aiPct === null ? "—" : String(aiPct)}
              unit={aiPct === null ? undefined : "%"}
              hint={`${data.containment.aiHandled} de ${data.containment.total} conversaciones`}
            />
            <Stat
              label="Comprobantes recibidos"
              value={String(data.paymentFunnel.received)}
              hint={`${data.paymentFunnel.pending} pendientes`}
            />
            <Stat
              label="Tiempo medio de validación"
              value={dur.value}
              unit={dur.unit || undefined}
              hint={`${data.validation.count} validados`}
            />
            <Stat
              label="Backlog de comprobantes"
              value={String(overdue.length)}
              footer={
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-500">≥</span>
                  <Stepper value={threshold} onChange={setThreshold} />
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-500">
                    días háb.
                  </span>
                </div>
              }
            />
          </div>

          {/* Actividad diaria */}
          <Section title="Actividad diaria">
            {data.daily.length === 0 ? (
              <Empty>No hay actividad en este período.</Empty>
            ) : (
              <DailyActivityChart data={data.daily} />
            )}
          </Section>

          {/* Comprobantes confirmados (donut) */}
          <Section title="Comprobantes confirmados">
            {data.paymentFunnel.received === 0 ? (
              <Empty>No llegaron comprobantes en este período.</Empty>
            ) : (
              <PaymentDonut
                received={data.paymentFunnel.received}
                validated={data.paymentFunnel.validated}
              />
            )}
          </Section>

          {/* Derivaciones por categoría (barra horizontal) */}
          <Section title="Derivaciones por categoría">
            {data.byCategory.length === 0 ? (
              <Empty>No hubo derivaciones al equipo en este período.</Empty>
            ) : (
              <CategoryBarChart
                data={data.byCategory.map((c) => ({
                  label: categoryLabel(c.category),
                  count: c.count,
                }))}
              />
            )}
          </Section>

          {/* Embudo de comprobantes */}
          <Section
            title="Embudo de comprobantes"
            aside={
              approvalPct === null
                ? undefined
                : `${approvalPct}% de aprobación`
            }
          >
            {data.paymentFunnel.received === 0 ? (
              <Empty>No llegaron comprobantes en este período.</Empty>
            ) : (
              <div className="space-y-2">
                <FunnelRow label="Recibidos" count={data.paymentFunnel.received} total={data.paymentFunnel.received} />
                <FunnelRow label="Pendientes" count={data.paymentFunnel.pending} total={data.paymentFunnel.received} dot="neutral" />
                <FunnelRow label="Validados" count={data.paymentFunnel.validated} total={data.paymentFunnel.received} dot="ok" />
                <FunnelRow label="Rechazados" count={data.paymentFunnel.rejected} total={data.paymentFunnel.received} dot="red" />
              </div>
            )}
          </Section>

          {/* Backlog operativo */}
          <Section
            title="Backlog operativo"
            aside={
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  Umbral (días hábiles)
                </span>
                <Stepper value={threshold} onChange={setThreshold} />
              </div>
            }
          >
            {overdue.length === 0 ? (
              <Empty>
                Sin comprobantes pendientes hace {threshold} días hábiles o más.
              </Empty>
            ) : (
              <div className="space-y-1.5">
                {overdue.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={1.75} />
                      <span className="truncate text-[13px] text-neutral-800 dark:text-neutral-100">
                        {p.senderName ?? "Emisor no leído"}
                      </span>
                      <span className="font-mono text-[12px] text-neutral-500">{fmtAmount(p.amount)}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        Recibido {fmtDate(p.createdAt)}
                      </span>
                      <span className="text-[12px] font-medium text-warn">
                        {p.businessDays} d háb
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  hint,
  accent,
  footer,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  accent?: "warn";
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {/* min-h reserva 2 líneas: los números arrancan siempre a la misma
          altura aunque un label ocupe una o dos líneas. */}
      <p className="min-h-[28px] font-mono text-[10px] uppercase leading-[1.35] tracking-[0.07em] text-neutral-600 dark:text-neutral-300">
        {label}
      </p>
      {/* Número en Geist Sans (font por defecto del body): más elegante que el
          mono. Grande y semibold para que sea el dato hero. tabular-nums alinea
          los dígitos. */}
      <p className="mt-2.5 flex items-baseline gap-1">
        <span
          className={`text-[36px] font-bold leading-none tracking-tight-er tabular-nums ${
            accent === "warn" ? "text-warn" : "text-neutral-900 dark:text-neutral-50"
          }`}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[13px] font-medium text-neutral-400 dark:text-neutral-500">
            {unit}
          </span>
        )}
      </p>
      {footer ? (
        <div className="mt-2.5">{footer}</div>
      ) : (
        hint && <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-500">{hint}</p>
      )}
    </div>
  );
}

/** Stepper ± compacto (umbral de días hábiles). Reusado en la card de Backlog
 *  y en la sección Backlog operativo: ambos editan el mismo estado. */
function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-800">
      <button
        onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-6 w-6 items-center justify-center rounded-l-md text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="Bajar umbral"
      >
        <Minus className="h-3 w-3" strokeWidth={2} />
      </button>
      <span className="w-5 text-center font-mono text-[12px] text-neutral-900 dark:text-neutral-100">
        {value}
      </span>
      <button
        onClick={() => onChange(value + 1)}
        className="flex h-6 w-6 items-center justify-center rounded-r-md text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="Subir umbral"
      >
        <Plus className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{title}</h2>
        {typeof aside === "string" ? (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {aside}
          </span>
        ) : (
          aside
        )}
      </div>
      {children}
    </section>
  );
}

function FunnelRow({
  label,
  count,
  total,
  dot,
}: {
  label: string;
  count: number;
  total: number;
  dot?: "neutral" | "ok" | "red";
}) {
  const pct = total ? (count / total) * 100 : 0;
  const dotCls =
    dot === "ok"
      ? "bg-gold"
      : dot === "red"
        ? "bg-red-600 dark:bg-red-500"
        : "bg-neutral-400 dark:bg-neutral-500";
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-[12px] text-neutral-700 dark:text-neutral-300">
        {dot && <span className={`h-2 w-2 rounded-full ${dotCls}`} />}
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div className="h-full bg-neutral-900 dark:bg-neutral-50" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[12px] text-neutral-600 dark:text-neutral-300">
        {count}
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-2 text-[12px] text-neutral-500 dark:text-neutral-500">{children}</p>
  );
}
