"use client";

import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { useIsDark } from "./useIsDark";

// Donut del estado de los comprobantes: el número del centro es el % de
// validados sobre los comprobantes REALES, es decir sin contar las imágenes que
// no eran un comprobante (capturas, títulos sueltos). Si se cuentan, el
// indicador se hunde y se lee como si los pagos estuvieran fallando: con 260
// imágenes y 114 descartes daba 56% confirmados cuando el número real es 99%.
// Dos porciones en grises (look del Dashboard de Hábitat): validados (gris
// fuerte) y el resto (gris suave). El desglose pendientes/rechazados vive en el
// embudo. Los comprobantes del cierre masivo del 18/11 tampoco entran al
// denominador: no fueron una revisión en el panel.

const PAL = {
  light: { ok: "#525252", rest: "#e5e5e5", bg: "#ffffff" },
  dark: { ok: "#d4d4d4", rest: "#404040", bg: "#0f0f0f" },
};

export function PaymentDonut({
  reales,
  validated,
  descartados = 0,
}: {
  /** Comprobantes reales del período: pendientes + validados + rechazados. */
  reales: number;
  validated: number;
  /** Imágenes que no eran un comprobante. Ya fuera de `reales`; solo para la nota. */
  descartados?: number;
}) {
  const dark = useIsDark();
  const c = dark ? PAL.dark : PAL.light;
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
    <div className="flex flex-col items-center gap-5 font-jakarta sm:flex-row sm:gap-9">
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
          <span className="font-jakarta text-[32px] font-bold leading-none tracking-[-0.03em] tabular-nums text-neutral-900 dark:text-neutral-50">
            {pct === null ? "—" : `${pct}%`}
          </span>
          <span className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            confirmados
          </span>
        </div>
      </div>

      <div className="w-full max-w-[280px] space-y-2">
        <div className="flex items-center gap-2 text-[12px]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: c.ok }}
          />
          <span className="flex-1 text-neutral-700 dark:text-neutral-300">Validados</span>
          <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{validated}</span>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: c.rest }}
          />
          <span className="flex-1 text-neutral-700 dark:text-neutral-300">
            Comprobantes del período
          </span>
          <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{reales}</span>
        </div>
        <p className="pt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          % de comprobantes confirmados en el período.
          {descartados > 0 ? (
            <>
              {" "}
              Quedan afuera {descartados}{" "}
              {descartados === 1 ? "imagen que no era" : "imágenes que no eran"} un
              comprobante (capturas, títulos sueltos).
            </>
          ) : null}{" "}
          Sin el cierre masivo del 18/11.
          El desglose de pendientes y rechazados está en el embudo.
        </p>
      </div>
    </div>
  );
}
