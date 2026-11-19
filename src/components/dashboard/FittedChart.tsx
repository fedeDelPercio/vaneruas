"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Copiado de atp-habitat (src/components/dashboard/FittedChart.tsx) sin cambios
// de lógica: decide si las etiquetas de valor entran sin pisarse (dense).

type ChartValue = { label: string; value: number | null };

// Conserva todos los puntos y oculta solo las etiquetas que no caben sin solaparse.
export function FittedChart({ label, values = [], percent = false, children }: {
  label: string;
  values?: ChartValue[];
  percent?: boolean;
  children: (layout: { tooltipPortal: HTMLDivElement | null; dense: boolean }) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tooltipPortal, setTooltipPortal] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const format = (value: number) => `${value.toLocaleString('es-AR')}${percent ? '%' : ''}`;
  const pointSpacing = Math.max(0, width - 92) / Math.max(1, values.length - 1);
  let previous: { index: number; halfWidth: number } | null = null;
  const dense = width > 0 && values.some((row, index) => {
    if (row.value === null) return false;
    const halfWidth = (format(row.value).length * 6 + 4) / 2;
    const overlaps = previous !== null && (index - previous.index) * pointSpacing < previous.halfWidth + halfWidth;
    previous = { index, halfWidth };
    return overlaps;
  });
  return <div ref={root} className="min-w-0 w-full" role="region" aria-label={label}>
    <div className="relative min-w-0 w-full">
      {children({ tooltipPortal, dense })}
      <div ref={setTooltipPortal} className="pointer-events-none absolute right-2 top-2 z-10 max-w-[calc(100%-1rem)] [&_.recharts-tooltip-wrapper]:max-w-full" />
    </div>
  </div>;
}
