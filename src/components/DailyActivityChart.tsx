"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useIsDark } from "./useIsDark";

// Chart de actividad diaria: mensajes y comprobantes por día. Refined minimal,
// alineado al design system del panel (paleta neutra, mono en los ejes, un
// único acento `ok` para la serie de comprobantes). Eje doble: mensajes y
// comprobantes tienen escalas muy distintas (muchos mensajes vs pocos
// comprobantes), así que cada serie va contra su propio eje y ambas quedan
// legibles. Tooltip y leyenda propios para control total del estilo.

type DailyPoint = { date: string; mensajes: number; comprobantes: number };

// Colores resueltos por tema (recharts necesita strings, no clases tailwind).
// Acento de marca: la serie de comprobantes va en dorado (más oscuro en light
// para que se lea sobre blanco); mensajes en neutro para distinguir ambas.
const PALETTE = {
  light: { msg: "#171717", comp: "#d97706", grid: "#e5e5e5", axis: "#a3a3a3" },
  dark: { msg: "#fafafa", comp: "#f9a900", grid: "#262626", axis: "#737373" },
};

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}

type Palette = (typeof PALETTE)["light"];

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number }[];
  c?: Palette;
}

function ChartTooltipBox({ active, label, payload, c }: TooltipProps) {
  if (!active || !payload?.length || !c) return null;
  const get = (k: string) =>
    payload.find((p) => p.dataKey === k)?.value ?? 0;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark">
      <p className="font-mono text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label ? fmtDay(label) : ""}
      </p>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-4 text-[12px]">
          <span className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
            <Dot color={c.msg} /> Mensajes
          </span>
          <span className="font-mono text-neutral-900 dark:text-neutral-50">{get("mensajes")}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-[12px]">
          <span className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
            <Dot color={c.comp} /> Comprobantes
          </span>
          <span className="font-mono text-neutral-900 dark:text-neutral-50">{get("comprobantes")}</span>
        </div>
      </div>
    </div>
  );
}

export function DailyActivityChart({ data }: { data: DailyPoint[] }) {
  const dark = useIsDark();
  const c = dark ? PALETTE.dark : PALETTE.light;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
          <Dot color={c.msg} /> Mensajes
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
          <Dot color={c.comp} /> Comprobantes
        </span>
      </div>

      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="fillMensajes" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.msg} stopOpacity={0.16} />
                <stop offset="100%" stopColor={c.msg} stopOpacity={0} />
              </linearGradient>
            </defs>
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
            {/* Eje único compartido: ambas series en la MISMA escala, así la
                altura refleja la magnitud real (15 mensajes > 2 comprobantes).
                Un eje doble se veía engañoso (el verde quedaba más alto con
                menos cantidad). */}
            <YAxis hide />
            <Tooltip
              cursor={{ stroke: c.grid, strokeWidth: 1 }}
              content={<ChartTooltipBox c={c} />}
            />
            <Area
              dataKey="mensajes"
              type="monotone"
              stroke={c.msg}
              strokeWidth={1.75}
              fill="url(#fillMensajes)"
              dot={false}
              activeDot={{ r: 3, fill: c.msg, strokeWidth: 0 }}
            />
            <Area
              dataKey="comprobantes"
              type="monotone"
              stroke={c.comp}
              strokeWidth={1.75}
              fill="none"
              dot={false}
              activeDot={{ r: 3, fill: c.comp, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
