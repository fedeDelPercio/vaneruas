"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { Loader2, Minus, Plus, RefreshCw } from "lucide-react";
import type { MetricsResponse, SharePoint } from "@/app/api/metrics/route";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";
import { FittedChart } from "./dashboard/FittedChart";
import { StatCard } from "./dashboard/StatCard";
import { PaymentDonut } from "./PaymentDonut";

// Dashboard de métricas del cliente, con el lenguaje visual del Dashboard de
// Hábitat: tarjetas KPI con sparkline y variación contra el período anterior,
// gráficos grises minimalistas (barras por día, área para tasas) y selectores
// segmentados. Toda la página va en Plus Jakarta (font-jakarta en la raíz; los
// <text> de los SVG de recharts y los tooltips la heredan). Lee /api/metrics;
// ver ahí la definición de cada número.

type Days = 7 | 30 | 90;
type Escala = "semanal" | "mensual";

const BACKLOG_KEY = "atp.backlogThresholdDays";
const GRAY = "#737373";
const muted = "text-neutral-500 dark:text-neutral-400";

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

function fmtDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)} min`;
  if (hours < 24) return `${hours.toFixed(1).replace(".", ",")} h`;
  return `${(hours / 24).toFixed(1).replace(".", ",")} días`;
}

function fmtAmount(amount: number | null): string {
  if (amount === null) return "·";
  return `ARS ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0 }).format(amount)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

const shortDay = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
const count = (v: number) => v.toLocaleString("es-AR");
const format = (value: number | null, percent = false) =>
  value === null ? "Sin datos" : `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}${percent ? "%" : ""}`;

// Selector segmentado (copiado de Hábitat).
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-fit items-center gap-1 rounded-md border border-neutral-200 p-0.5 dark:border-neutral-800"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-sm px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-50 ${
            value === o.value
              ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MetricsDashboard() {
  const [days, setDays] = useState<Days>(30);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    void (async () => {
      try {
        const r = await fetch(`/api/metrics?period=${days}d`, { cache: "no-store", signal: controller.signal });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.kpis) throw new Error();
        if (!controller.signal.aborted) setData(j as MetricsResponse);
      } catch {
        if (!controller.signal.aborted) setError("No pudimos cargar las métricas. Probá actualizar.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [days, refresh]);

  // Backlog: pendientes con >= threshold días hábiles desde la recepción.
  const overdue = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    return data.pending
      .map((p) => ({ ...p, businessDays: businessDaysElapsed(new Date(p.createdAt), now) }))
      .filter((p) => p.businessDays >= threshold)
      .sort((a, b) => b.businessDays - a.businessDays);
  }, [data, threshold]);

  const approvalPct = useMemo(() => {
    if (!data) return null;
    const { validated, rejected } = data.paymentFunnel;
    const resolved = validated + rejected;
    return resolved === 0 ? null : Math.round((validated / resolved) * 100);
  }, [data]);

  return (
    <div className="dashboard-surface mx-auto w-full max-w-5xl px-4 py-5 font-jakarta sm:px-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight-er text-neutral-900 dark:text-neutral-50">Métricas</h1>
          <p className={`mt-1 text-[12px] ${muted}`}>Últimos {days} días · hora de Argentina</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            label="Período"
            value={days}
            options={([7, 30, 90] as const).map((value) => ({ value, label: `${value} días` }))}
            onChange={setDays}
            disabled={loading}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => setRefresh((v) => v + 1)}
            aria-label="Actualizar métricas"
            className="rounded-md border border-neutral-200 p-2 text-neutral-500 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-[12px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {loading && (
        <div role="status" className={`flex items-center justify-center gap-2 py-20 text-[12px] ${muted}`}>
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          Cargando métricas…
        </div>
      )}

      {data && (
        <>
          {/* Tarjetas KPI */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile id="kpi-automation">
              <StatCard
                label="Tasa de automatización · mensajes"
                labelId="kpi-automation"
                value={data.kpis.automation.total}
                percent
                chart={data.kpis.automation}
              >
                Mensajes enviados por IA sobre los enviados por IA y equipo. Tendencia por semana.
                {!data.kpis.automation.cubierto && (
                  <span className="mt-1 block text-[11px] text-warn-fg dark:text-warn">
                    {data.kpis.automation.coberturaDesde
                      ? `Los mensajes del equipo se registran desde el ${fmtDate(data.kpis.automation.coberturaDesde)}: el tramo anterior queda alto.`
                      : "Todavía no hay registro de mensajes del equipo: la tasa queda alta."}
                  </span>
                )}
              </StatCard>
            </KpiTile>
            <KpiTile id="kpi-received">
              <StatCard
                label="Comprobantes recibidos"
                labelId="kpi-received"
                value={data.kpis.received.total}
                chart={data.kpis.received}
              >
                {data.kpis.received.pending} pendientes
                {data.kpis.received.cierreMasivo > 0
                  ? ` · ${data.kpis.received.cierreMasivo} resueltos por WhatsApp (cierre masivo)`
                  : ""}
                {data.kpis.received.descartados > 0
                  ? ` · ${data.kpis.received.descartados} descartados, fuera del total`
                  : ""}
              </StatCard>
            </KpiTile>
            <KpiTile id="kpi-validation">
              <StatCard
                label="Tiempo medio de validación"
                labelId="kpi-validation"
                value={data.kpis.validation.total}
                format={fmtDuration}
                chart={data.kpis.validation}
                invert
              >
                {data.kpis.validation.count} validados en el período
              </StatCard>
            </KpiTile>
            <KpiTile id="kpi-backlog">
              <StatCard
                label="Backlog de comprobantes"
                labelId="kpi-backlog"
                value={overdue.length}
                chart={data.kpis.backlog}
              >
                <div className="flex items-center gap-1.5">
                  <span>≥</span>
                  <Stepper value={threshold} onChange={setThreshold} />
                  <span>días háb. · {data.kpis.backlog.total} pendientes</span>
                </div>
              </StatCard>
            </KpiTile>
          </div>

          <div className="space-y-4">
            <Panel title="Actividad diaria" description="Mensajes de la conversación (IA, equipo y contactos), por día.">
              {data.daily.every((d) => d.mensajes === 0) ? (
                <EmptyChart>Sin actividad en el período</EmptyChart>
              ) : (
                <DailyBars
                  title="Actividad diaria"
                  rows={data.daily}
                  series={[{ key: "mensajes", label: "Mensajes", color: GRAY }]}
                />
              )}
            </Panel>

            <Panel
              title="Mensajes escritos por el equipo, día a día"
              description="Mensajes que escribió una persona del equipo, no la IA."
              aside={teamAside(data.daily)}
            >
              {data.daily.every((d) => d.equipo === 0) ? (
                <EmptyChart>Sin mensajes del equipo en el período</EmptyChart>
              ) : (
                <DailyBars
                  title="Mensajes del equipo"
                  rows={data.daily}
                  series={[{ key: "equipo", label: "Mensajes del equipo", color: GRAY }]}
                />
              )}
            </Panel>

            <ApprovalsPanel rows={data.approvalsDaily} />

            <SharePanel semanal={data.share.semanal} mensual={data.share.mensual} />

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Comprobantes confirmados" description="Validados sobre los comprobantes reales del período.">
                {data.paymentFunnel.pending + data.paymentFunnel.validated + data.paymentFunnel.rejected === 0 ? (
                  <EmptyChart>No llegaron comprobantes en este período</EmptyChart>
                ) : (
                  <PaymentDonut
                    reales={data.paymentFunnel.pending + data.paymentFunnel.validated + data.paymentFunnel.rejected}
                    validated={data.paymentFunnel.validated}
                    descartados={data.paymentFunnel.descartados}
                  />
                )}
              </Panel>

              <Panel
                title="Embudo de comprobantes"
                description="Comprobantes del período por estado actual. Sin imágenes agrupadas."
                aside={approvalPct === null ? undefined : `${approvalPct}% de aprobación`}
              >
                {data.paymentFunnel.received === 0 && data.paymentFunnel.descartados === 0 ? (
                  <EmptyChart>No llegaron comprobantes en este período</EmptyChart>
                ) : (
                  <FunnelRows funnel={data.paymentFunnel} />
                )}
              </Panel>
            </div>

            <Panel
              title="Derivaciones por categoría"
              description="Pedidos de intervención al equipo. Una conversación puede tener más de una."
            >
              {data.byCategory.length === 0 ? (
                <EmptyChart>Sin derivaciones al equipo en el período</EmptyChart>
              ) : (
                <CategoryChart
                  rows={data.byCategory.map((c) => ({ label: categoryLabel(c.category), count: c.count }))}
                />
              )}
            </Panel>

            <Panel
              title="Backlog operativo"
              description="Comprobantes pendientes hace varios días hábiles. No depende del período."
              aside={
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] ${muted}`}>Umbral (días hábiles)</span>
                  <Stepper value={threshold} onChange={setThreshold} />
                </div>
              }
            >
              {overdue.length === 0 ? (
                <p className={`py-2 text-[12px] ${muted}`}>
                  Sin comprobantes pendientes hace {threshold} días hábiles o más
                </p>
              ) : (
                <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {overdue.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-neutral-900 dark:text-neutral-100">
                          {p.senderName ?? "Sin remitente"}
                        </p>
                        <p className={`text-[11px] tabular-nums ${muted}`}>
                          Recibido {fmtDate(p.createdAt)} · {fmtAmount(p.amount)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[12px] font-medium tabular-nums text-warn-fg dark:text-warn">
                        {p.businessDays} d háb
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function teamAside(daily: MetricsResponse["daily"]): string {
  const total = daily.reduce((a, b) => a + b.equipo, 0);
  const conActividad = daily.filter((d) => d.equipo > 0).length;
  return `${count(total)} mensajes · ${conActividad} de ${daily.length} días`;
}

function KpiTile({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
    >
      {children}
    </section>
  );
}

function Panel({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-snug text-neutral-900 dark:text-neutral-50">
            {title}
          </h2>
          {description && <p className={`mt-1 text-[12px] ${muted}`}>{description}</p>}
        </div>
        {typeof aside === "string" ? <span className={`text-[11px] tabular-nums ${muted}`}>{aside}</span> : aside}
      </div>
      {children}
    </section>
  );
}

function EmptyChart({ children }: { children: ReactNode }) {
  return <div className={`flex h-48 items-center justify-center text-[12px] ${muted}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Gráficos (mismo look que el Dashboard de Hábitat: grises, ejes simples sin
// línea, grilla punteada suave). Barras para conteos por día; área para tasas,
// con etiquetas de valor cuando entran sin pisarse.

interface TrendRow {
  label: string;
  value: number | null;
  [k: string]: unknown;
}

function AreaTrend({
  title,
  rows,
  percent = false,
  detail,
  height = "h-56",
}: {
  title: string;
  rows: TrendRow[];
  percent?: boolean;
  /** Texto que sigue al valor en el tooltip. */
  detail?: (value: number, row: TrendRow) => string;
  height?: string;
}) {
  return (
    <FittedChart label={`${title}, valores por período`} values={rows} percent={percent}>
      {({ tooltipPortal, dense }) => (
        <ChartContainer config={{ value: { label: title, color: GRAY } }} className={`${height} w-full`}>
          <AreaChart accessibilityLayer data={rows} margin={{ left: 0, right: 24, top: 28 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 5" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval="preserveStartEnd"
              minTickGap={16}
              fontSize={11}
              padding={{ left: 12, right: 12 }}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              allowDecimals={false}
              tickCount={3}
              domain={percent ? [0, 100] : [0, "auto"]}
              tickFormatter={(v) => `${v}${percent ? "%" : ""}`}
            />
            <ChartTooltip
              portal={tooltipPortal}
              cursor={false}
              content={
                <ChartTooltipContent
                  className="max-w-full"
                  formatter={(value, _name, item) => (
                    <span className="max-w-56 whitespace-normal leading-relaxed">
                      {format(Number(value), percent)}
                      {detail ? detail(Number(value), item.payload as TrendRow) : ""}
                    </span>
                  )}
                />
              }
            />
            <Area
              dataKey="value"
              type="linear"
              stroke="var(--color-value)"
              strokeWidth={2}
              fill="var(--color-value)"
              fillOpacity={0.08}
              isAnimationActive={false}
              connectNulls={false}
              dot={rows.length <= 31 ? { r: 3, fill: "var(--color-value)", fillOpacity: 1, strokeWidth: 0 } : false}
              activeDot={{ r: 5, fillOpacity: 1 }}
            >
              {!dense && (
                <LabelList
                  dataKey="value"
                  position="top"
                  offset={10}
                  fontSize={11}
                  fill="rgb(var(--chart-foreground))"
                  fillOpacity={1}
                  formatter={(v) => (typeof v === "number" ? format(v, percent) : "")}
                />
              )}
            </Area>
          </AreaChart>
        </ChartContainer>
      )}
    </FittedChart>
  );
}

type SeriesDef = {
  key: string;
  label: string;
} & ({ color: string; theme?: never } | { color?: never; theme: { light: string; dark: string } });

/**
 * Barras por día en grises (estilo del BarChart de Hábitat: radio sutil, sin
 * líneas de eje). Con más de una serie muestra leyenda; `stacked` las apila.
 */
function DailyBars<T extends { date: string }>({
  title,
  rows,
  series,
  stacked = false,
}: {
  title: string;
  rows: T[];
  series: SeriesDef[];
  stacked?: boolean;
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, s.theme ? { label: s.label, theme: s.theme } : { label: s.label, color: s.color }]),
  );
  const data = rows.map((r) => ({ ...r, label: shortDay(r.date) }));
  const top = series.at(-1)?.key;
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-4">
          {series.map((s) => (
            <span key={s.key} className={`flex items-center gap-1.5 text-[11px] ${muted}`}>
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: `var(--legend-${s.key})` }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <FittedChart label={`${title}, valores por día`}>
        {({ tooltipPortal }) => (
          <ChartContainer config={config} className="h-56 w-full">
            <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 12, top: 12 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} strokeDasharray="2 5" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval="preserveStartEnd"
                minTickGap={16}
                fontSize={11}
              />
              <YAxis width={44} tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} tickCount={3} />
              <ChartTooltip portal={tooltipPortal} content={<ChartTooltipContent className="max-w-full" />} />
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId={stacked ? "a" : undefined}
                  fill={`var(--color-${s.key})`}
                  // Radio sutil solo arriba de la pila (o de cada barra suelta).
                  radius={!stacked || s.key === top ? [2, 2, 0, 0] : 0}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </FittedChart>
      {/* La leyenda lee los mismos colores que el gráfico (variables --color-*
          que define ChartContainer). Se replican acá porque la leyenda vive
          fuera del contenedor del chart. */}
      {series.length > 1 && <LegendVars series={series} />}
    </div>
  );
}

function LegendVars({ series }: { series: SeriesDef[] }) {
  const rule = (theme: "light" | "dark") =>
    series.map((s) => `--legend-${s.key}: ${s.theme ? s.theme[theme] : s.color};`).join(" ");
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `.dashboard-surface { ${rule("light")} } .dark .dashboard-surface { ${rule("dark")} }`,
      }}
    />
  );
}

function ApprovalsPanel({ rows }: { rows: MetricsResponse["approvalsDaily"] }) {
  const validados = rows.reduce((a, r) => a + r.comprobantesValidados, 0);
  const rechazados = rows.reduce((a, r) => a + r.comprobantesRechazados, 0);
  const titulos = rows.reduce((a, r) => a + r.titulos, 0);
  const total = validados + rechazados + titulos;
  return (
    <Panel
      title="Aprobaciones realizadas por el equipo"
      description={`${count(total)} en el período · ${count(validados + rechazados)} comprobantes y ${count(titulos)} títulos revisados. Sin el cierre masivo del 18/11 ni imágenes agrupadas.`}
    >
      {total === 0 ? (
        <EmptyChart>Sin revisiones del equipo en el período</EmptyChart>
      ) : (
        <DailyBars
          title="Aprobaciones del equipo"
          rows={rows}
          stacked
          series={[
            { key: "comprobantesValidados", label: "Validados", theme: { light: "#404040", dark: "#d4d4d4" } },
            { key: "comprobantesRechazados", label: "Rechazados o descartados", theme: { light: "#a3a3a3", dark: "#737373" } },
            { key: "titulos", label: "Títulos revisados", theme: { light: "#d4d4d4", dark: "#525252" } },
          ]}
        />
      )}
    </Panel>
  );
}

function SharePanel({ semanal, mensual }: { semanal: SharePoint[]; mensual: SharePoint[] }) {
  const [escala, setEscala] = useState<Escala>("semanal");
  const data = escala === "semanal" ? semanal : mensual;
  const enCurso = data.at(-1)?.periodo;
  const rows: TrendRow[] = data.map((p) => ({
    label: escala === "semanal" ? p.label : p.label.replace(".", ""),
    value: p.pct,
    ia: p.ia,
    equipo: p.equipo,
    enCurso: p.periodo === enCurso,
  }));
  return (
    <Panel
      title={`Tasa de automatización · mensajes, ${escala === "semanal" ? "semana a semana" : "mes a mes"}`}
      description="Mensajes enviados por IA sobre los enviados por IA y equipo. No depende del período elegido."
      aside={
        <Segmented
          label="Agrupar por"
          value={escala}
          options={[
            { value: "semanal" as const, label: "Semanal" },
            { value: "mensual" as const, label: "Mensual" },
          ]}
          onChange={setEscala}
        />
      }
    >
      {rows.every((r) => r.value === null) ? (
        <EmptyChart>Sin datos en el tramo</EmptyChart>
      ) : (
        <AreaTrend
          title="Tasa de automatización"
          rows={rows}
          percent
          detail={(_v, row) => ` · ${row.ia} IA / ${row.equipo} equipo${row.enCurso ? " · en curso" : ""}`}
        />
      )}
      <p className={`mt-2 text-[11px] ${muted}`}>
        {escala === "semanal" ? "Por semana, de lunes a domingo" : "Por mes calendario"} · el último tramo está en curso ·
        sin dato antes de que se registren los mensajes del equipo
      </p>
    </Panel>
  );
}

function CategoryChart({ rows }: { rows: { label: string; count: number }[] }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const valueLabel = (value: number) => `${count(value)} · ${format(total ? Math.round((value / total) * 1000) / 10 : null, true)}`;
  const labelWidth = Math.max(86, ...rows.map((r) => valueLabel(r.count).length * 7 + 16));
  return (
    <div>
      <p className="mb-3 font-jakarta text-[32px] font-bold leading-none tracking-[-0.03em] tabular-nums text-neutral-900 dark:text-neutral-50">
        {count(total)} <span className={`text-[12px] font-normal tracking-normal ${muted}`}>derivaciones</span>
      </p>
      <FittedChart label="Derivaciones por categoría, cantidad y porcentaje">
        {({ tooltipPortal }) => (
          <ChartContainer
            config={{ count: { label: "Derivaciones", color: GRAY } }}
            className="w-full"
            style={{ height: Math.max(160, rows.length * 38 + 20) }}
          >
            <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 0, right: labelWidth, top: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="label" type="category" width={150} axisLine={false} tickLine={false} fontSize={11} />
              <ChartTooltip
                portal={tooltipPortal}
                content={
                  <ChartTooltipContent
                    className="max-w-full"
                    hideLabel
                    formatter={(value, _name, item) => (
                      <span className="max-w-56 whitespace-normal leading-relaxed">
                        {(item.payload as { label: string }).label}: {valueLabel(Number(value))}
                      </span>
                    )}
                  />
                }
              />
              <Bar dataKey="count" fill="var(--color-count)" barSize={12} radius={2} isAnimationActive={false}>
                <LabelList
                  dataKey="count"
                  position="right"
                  offset={8}
                  fontSize={11}
                  fill="rgb(var(--chart-foreground))"
                  formatter={(v) => (typeof v === "number" ? valueLabel(v) : "")}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </FittedChart>
    </div>
  );
}

/** Stepper ± compacto (umbral de días hábiles). Reusado en la tarjeta de
 *  Backlog y en la sección Backlog operativo: ambos editan el mismo estado. */
function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-6 w-6 items-center justify-center rounded-l-md text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="Bajar umbral"
      >
        <Minus className="h-3 w-3" strokeWidth={2} />
      </button>
      <span className="w-5 text-center text-[12px] font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-6 w-6 items-center justify-center rounded-r-md text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="Subir umbral"
      >
        <Plus className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
}

/** Filas del embudo. "Recibidos" coincide con la tarjeta: pendientes +
 *  validados + rechazados + cierre masivo. Los descartados (no eran un
 *  comprobante) van aparte, fuera del total. */
function FunnelRows({ funnel }: { funnel: MetricsResponse["paymentFunnel"] }) {
  const total = funnel.received;
  return (
    <div className="space-y-3">
      <FunnelRow label="Recibidos" count={total} total={total} strong />
      <FunnelRow label="Pendientes" count={funnel.pending} total={total} />
      <FunnelRow label="Validados" count={funnel.validated} total={total} />
      <FunnelRow label="Rechazados" count={funnel.rejected} total={total} dot="red" />
      {funnel.cierreMasivo > 0 && (
        <FunnelRow label="Resueltos por WhatsApp (cierre masivo)" count={funnel.cierreMasivo} total={total} />
      )}
      {funnel.descartados > 0 && (
        <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <FunnelRow
            label="Descartados, no eran un comprobante"
            count={funnel.descartados}
            total={total}
            hint="Fuera del total"
          />
        </div>
      )}
    </div>
  );
}

function FunnelRow({
  label,
  count: n,
  total,
  dot,
  strong = false,
  hint,
}: {
  label: string;
  count: number;
  total: number;
  dot?: "red";
  strong?: boolean;
  hint?: string;
}) {
  const pct = total ? Math.min(100, (n / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px]">
        <span
          className={`flex min-w-0 items-center gap-1.5 ${
            strong ? "font-medium text-neutral-900 dark:text-neutral-50" : "text-neutral-700 dark:text-neutral-300"
          }`}
        >
          {dot && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-red-600 dark:bg-red-500" />}
          <span className="truncate">{label}</span>
          {hint && <span className={`shrink-0 text-[11px] ${muted}`}>· {hint}</span>}
        </span>
        <span className="shrink-0 font-medium tabular-nums text-neutral-900 dark:text-neutral-50">{n.toLocaleString("es-AR")}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-800">
        <div className="h-full bg-neutral-500 dark:bg-neutral-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
