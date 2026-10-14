"use client";

import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { useIsDark } from "./useIsDark";

// Donut del estado de los comprobantes: el número del centro es el % de
// validados sobre los comprobantes REALES, es decir sin contar las imágenes que
// no eran un comprobante (capturas, títulos sueltos). Si se cuentan, el
// indicador se hunde y se lee como si los pagos estuvieran fallando: con 260
// imágenes y 114 descartes daba 56% confirmados cuando el número real es 99%.
// Dos porciones: validados (dorado de marca) y el resto (neutro). El desglose
// pendientes/rechazados vive en el embudo.

const PAL = {
  light: { ok: "#d97706", rest: "#d4d4d4", bg: "#ffffff" },
  dark: { ok: "#f9a900", rest: "#404040", bg: "#171717" },
};

export function PaymentDonut({
  received,
  validated,
  descartados = 0,
}: {
  /** Todas las imágenes que entraron a Aprobaciones. */
  received: number;
  validated: number;
  /** Las que no eran un comprobante. Salen del denominador. */
  descartados?: number;
}) {
  const dark = useIsDark();
  const c = dark ? PAL.dark : PAL.light;
  const reales = Math.max(0, received - descartados);
  const pct = reales === 0 ? null : Math.round((validated / reales) * 100);
  const rest = Math.max(0, reales - validated);

  const data =
    reales === 0
      ? [{ key: "none", value: 1, fill: c.rest }]
      : [
          { key: "validated", value: validated, fill: c.ok },
          { key: "rest", value: rest, fill: c.rest },
        ].filter((s) => s.value > 0);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-9">
      <div className="relative h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="key"
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={92}
              strokeWidth={3}
              stroke={c.bg}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Centro: overlay HTML centrado exacto sobre el agujero del donut. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[34px] font-bold leading-none tracking-tight-er tabular-nums text-neutral-900 dark:text-neutral-50">
            {pct === null ? "—" : `${pct}%`}
          </span>
          <span className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-500">
            confirmados
          </span>
        </div>
      </div>

      <div className="w-full max-w-[280px] space-y-2">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: c.ok }}
          />
          <span className="flex-1 text-neutral-700 dark:text-neutral-300">Validados</span>
          <span className="font-mono text-neutral-500">{validated}</span>
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: c.rest }}
          />
          <span className="flex-1 text-neutral-700 dark:text-neutral-300">
            Comprobantes del período
          </span>
          <span className="font-mono text-neutral-500">{reales}</span>
        </div>
        <p className="pt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
          % de comprobantes confirmados en el período.
          {descartados > 0 ? (
            <>
              {" "}
              Quedan afuera {descartados}{" "}
              {descartados === 1 ? "imagen que no era" : "imágenes que no eran"} un
              comprobante (capturas, títulos sueltos).
            </>
          ) : null}{" "}
          El desglose de pendientes y rechazados está en el embudo.
        </p>
      </div>
    </div>
  );
}
