"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SharePoint } from "@/app/api/metrics/route";
import { useIsDark } from "./useIsDark";

// Evolución del % de mensajes salientes que escribió la IA, por semana o por
// mes. El eje va de 0 a 100 fijo: con escala automática, una caída de 95 a 88
// se vería como un derrumbe. La línea punteada marca el promedio del tramo.
//
// Los buckets sin salientes (pct null) se dibujan como corte, no como cero:
// un período sin actividad no es "la IA no respondió nada".

const PALETTE = {
  light: { line: "#d97706", grid: "#e5e5e5", axis: "#a3a3a3", ref: "#a3a3a3" },
  dark: { line: "#f9a900", grid: "#262626", axis: "#737373", ref: "#737373" },
};

type Escala = "semanal" | "mensual";

interface TooltipProps {
  active?: boolean;
  payload?: { payload?: SharePoint }[];
  escala?: Escala;
}

function Box({ active, payload, escala }: TooltipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark">
      <p className="font-mono text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {escala === "mensual" ? p.label : `semana del ${p.label}`}
      </p>
      <p className="mt-1 text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
        {p.pct === null ? "sin datos" : `${p.pct}% IA`}
      </p>
      <p className="mt-0.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
        <span className="font-mono">{p.ia}</span> de la IA ·{" "}
        <span className="font-mono">{p.equipo}</span> del equipo
      </p>
    </div>
  );
}

export function AiShareChart({
  semanal,
  mensual,
}: {
  semanal: SharePoint[];
  mensual: SharePoint[];
}) {
  const dark = useIsDark();
  const c = dark ? PALETTE.dark : PALETTE.light;
  const [escala, setEscala] = useState<Escala>("semanal");
  const data = escala === "semanal" ? semanal : mensual;

  const conDatos = data.filter((d) => d.pct !== null);
  const promedio = conDatos.length
    ? Math.round(
        (conDatos.reduce((a, b) => a + b.ia, 0) /
          conDatos.reduce((a, b) => a + b.ia + b.equipo, 0)) *
          100,
      )
    : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11.5px] text-neutral-600 dark:text-neutral-300">
          {promedio === null ? (
            "Sin datos en el tramo"
          ) : (
            <>
              Promedio del tramo{" "}
              <span className="font-mono text-neutral-900 dark:text-neutral-50">{promedio}%</span>
            </>
          )}
        </span>
        <div className="flex gap-1">
          {(["semanal", "mensual"] as Escala[]).map((k) => (
            <button
              key={k}
              onClick={() => setEscala(k)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition ${
                escala === k
                  ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="fillShare" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.line} stopOpacity={0.18} />
                <stop offset="100%" stopColor={c.line} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={16}
              tick={{ fontSize: 10, fill: c.axis, fontFamily: "ui-monospace, monospace" }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tickLine={false}
              axisLine={false}
              width={34}
              tick={{ fontSize: 10, fill: c.axis, fontFamily: "ui-monospace, monospace" }}
            />
            {promedio !== null && (
              <ReferenceLine y={promedio} stroke={c.ref} strokeDasharray="3 3" strokeWidth={1} />
            )}
            <Tooltip
              cursor={{ stroke: c.grid, strokeWidth: 1 }}
              content={<Box escala={escala} />}
            />
            <Area
              dataKey="pct"
              type="monotone"
              stroke={c.line}
              strokeWidth={1.75}
              fill="url(#fillShare)"
              connectNulls={false}
              dot={{ r: 2, fill: c.line, strokeWidth: 0 }}
              activeDot={{ r: 3.5, fill: c.line, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
