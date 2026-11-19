import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { sparklineValues, type KpiData } from "@/lib/metrics/series";

// Copiado de atp-habitat (src/components/dashboard/StatCard.tsx). Titular de
// métrica: etiqueta chica, número grande en Plus Jakarta, mini tendencia a la
// derecha y variación contra el período anterior. Los datos de comparación
// vienen de la API (previousTotal/delta). Adaptado: `format` para valores que
// no son un conteo (duraciones).

const pct = (value: number) => value.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const defaultFormat = (value: number, percent: boolean) =>
  `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}${percent ? "%" : ""}`;
const muted = "text-neutral-500 dark:text-neutral-400";

export function StatCard({
  label,
  labelId,
  value,
  percent = false,
  format,
  chart,
  invert = false,
  children,
}: {
  label?: string;
  labelId?: string;
  value: number | null;
  percent?: boolean;
  /** Formatea el número principal y el del período anterior. */
  format?: (value: number) => string;
  chart?: Pick<KpiData, "series" | "delta" | "previousTotal">;
  // Para métricas donde subir es malo (tiempo de validación): ↑ en rojo, ↓ en verde.
  invert?: boolean;
  children?: ReactNode;
}) {
  const fmt = (v: number | null) =>
    v === null ? "Sin datos" : format ? format(v) : defaultFormat(v, percent);
  const spark = chart ? sparklineValues(chart) : null;
  return (
    <div className="min-w-0 font-jakarta">
      {label && (
        <p id={labelId} className={`text-[12px] font-medium ${muted}`}>
          {label}
        </p>
      )}
      <div className={`flex items-end justify-between gap-4 ${label ? "mt-1.5" : ""}`}>
        <p
          className={`min-w-0 break-words font-bold leading-none tracking-[-0.03em] tabular-nums text-neutral-900 dark:text-neutral-50 ${
            value === null ? "text-[20px]" : "text-[32px]"
          }`}
        >
          {fmt(value)}
        </p>
        {spark && <Sparkline values={spark} />}
      </div>
      {chart && (
        <Delta
          delta={chart.delta ?? null}
          previous={chart.previousTotal === null ? null : fmt(chart.previousTotal)}
          invert={invert}
        />
      )}
      {children && <div className={`mt-2 text-[12px] leading-relaxed ${muted}`}>{children}</div>}
    </div>
  );
}

function Delta({ delta, previous, invert }: { delta: number | null; previous: string | null; invert: boolean }) {
  const base = "mt-2.5 flex items-center gap-1.5 text-[11.5px]";
  const hint = previous === null ? undefined : `Período anterior: ${previous}`;
  if (delta === null) return <p className={`${base} ${muted}`}>Sin dato anterior</p>;
  if (delta === 0)
    return (
      <p className={`${base} ${muted}`} title={hint} aria-label="Sin cambio vs período anterior">
        <span className="font-medium tabular-nums">0%</span>
        <span>vs período anterior</span>
      </p>
    );
  const up = delta > 0;
  const good = up !== invert;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <p
      className={base}
      title={hint}
      aria-label={`${up ? "Subió" : "Bajó"} ${pct(Math.abs(delta))} % vs período anterior`}
    >
      <span
        aria-hidden="true"
        className={`flex items-center gap-0.5 font-medium tabular-nums ${
          good ? "text-ok-fg dark:text-ok" : "text-red-600 dark:text-red-400"
        }`}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
        {pct(Math.abs(delta))}%
      </span>
      <span aria-hidden="true" className={muted}>
        vs período anterior
      </span>
    </p>
  );
}

// Mini tendencia en SVG: línea fina monocroma con relleno suave. Los huecos (null)
// cortan la línea en vez de caer a 0. Escala del mínimo al máximo de la serie.
const W = 104;
const H = 36;
const PAD = 3;
function Sparkline({ values }: { values: (number | null)[] }) {
  const nums = values.filter((v): v is number => v !== null);
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = max - min || 1;
  const x = (i: number) => (values.length === 1 ? W / 2 : PAD + (i / (values.length - 1)) * (W - PAD * 2));
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
  const segments: { i: number; v: number }[][] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const last = segments.at(-1);
    if (last && last.at(-1)!.i === i - 1) last.push({ i, v });
    else segments.push([{ i, v }]);
  });
  const lastPoint = segments.at(-1)?.at(-1);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0 overflow-visible text-neutral-500 dark:text-neutral-400"
    >
      {segments.map((seg, k) => {
        const line = seg.map((p, j) => `${j ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
        return (
          <g key={k}>
            {seg.length > 1 && (
              <path
                d={`${line} L${x(seg.at(-1)!.i).toFixed(1)} ${H - PAD} L${x(seg[0]!.i).toFixed(1)} ${H - PAD} Z`}
                fill="currentColor"
                fillOpacity={0.1}
              />
            )}
            {seg.length > 1 ? (
              <path
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : (
              <circle cx={x(seg[0]!.i)} cy={y(seg[0]!.v)} r={1.5} fill="currentColor" />
            )}
          </g>
        );
      })}
      {lastPoint && (
        <circle cx={x(lastPoint.i)} cy={y(lastPoint.v)} r={2.25} className="fill-neutral-900 dark:fill-neutral-50" />
      )}
    </svg>
  );
}
