"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useIsDark } from "./useIsDark";

// Mensajes que escribió el EQUIPO por día (no la IA). Barras y no área: son
// valores chicos y discontinuos (hay días enteros en cero), y el área sugiere
// una continuidad que no existe. Dorado de marca, que es la serie protagonista
// de este chart.

type Point = { date: string; equipo: number };

const PALETTE = {
  light: { bar: "#d97706", grid: "#e5e5e5", axis: "#a3a3a3" },
  dark: { bar: "#f9a900", grid: "#262626", axis: "#737373" },
};

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: { value?: number }[];
}

function Box({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark">
      <p className="font-mono text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label ? fmtDay(label) : ""}
      </p>
      <p className="mt-1 text-[12px] text-neutral-900 dark:text-neutral-50">
        <span className="font-mono">{v}</span>{" "}
        <span className="text-neutral-600 dark:text-neutral-300">
          {v === 1 ? "mensaje del equipo" : "mensajes del equipo"}
        </span>
      </p>
    </div>
  );
}

export function TeamActivityChart({ data }: { data: Point[] }) {
  const dark = useIsDark();
  const c = dark ? PALETTE.dark : PALETTE.light;
  const total = data.reduce((a, b) => a + b.equipo, 0);
  const conActividad = data.filter((d) => d.equipo > 0).length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-[11.5px] text-neutral-600 dark:text-neutral-300">
        <span>
          <span className="font-mono text-neutral-900 dark:text-neutral-50">{total}</span> mensajes
        </span>
        <span>
          <span className="font-mono text-neutral-900 dark:text-neutral-50">{conActividad}</span> de{" "}
          <span className="font-mono">{data.length}</span> días con actividad
        </span>
      </div>

      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDay}
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={28}
              tick={{ fontSize: 10, fill: c.axis, fontFamily: "ui-monospace, monospace" }}
            />
            <YAxis hide />
            <Tooltip cursor={{ fill: c.grid, fillOpacity: 0.4 }} content={<Box />} />
            <Bar dataKey="equipo" fill={c.bar} radius={[2, 2, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
