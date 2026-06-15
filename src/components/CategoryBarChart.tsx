"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useIsDark } from "./useIsDark";

// Barra horizontal de derivaciones por categoría. Monocromo (paleta neutra del
// design system): todas las barras del mismo neutro, el conteo como label al
// final de cada barra.

const PAL = {
  light: { bar: "#171717", text: "#525252" },
  dark: { bar: "#fafafa", text: "#a3a3a3" },
};

export function CategoryBarChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  const dark = useIsDark();
  const c = dark ? PAL.dark : PAL.light;
  const height = Math.max(120, data.length * 42 + 8);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 32, bottom: 0, left: 0 }}
          barCategoryGap={12}
        >
          <YAxis
            dataKey="label"
            type="category"
            tickLine={false}
            axisLine={false}
            width={168}
            tick={{ fontSize: 12, fill: c.text }}
          />
          <XAxis type="number" hide />
          <Bar dataKey="count" fill={c.bar} radius={4} barSize={18} isAnimationActive={false}>
            <LabelList
              dataKey="count"
              position="right"
              style={{ fontSize: 12, fill: c.text, fontFamily: "ui-monospace, monospace" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
