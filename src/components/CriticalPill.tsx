import { TriangleAlert } from "lucide-react";

// Pill "Crítico". Misma forma que el pill "Caliente" de Hábitat
// (LeadContext.tsx: rounded-full sólido, ícono + texto, versión compacta para
// la lista), con el rojo destructivo de este panel (red-600) en vez del
// #a33b42 de Hábitat. El motivo del clasificador va en el title.

export function CriticalPill({
  reason,
  compact = false,
}: {
  reason?: string | null;
  compact?: boolean;
}) {
  return (
    <span
      data-critical-badge
      title={reason ? `Crítico: ${reason}` : "Conversación crítica"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-red-600 font-medium text-white ${
        compact ? "px-1.5 py-0.5 text-[10px] leading-[14px]" : "px-2 py-0.5 text-[11px] leading-4"
      }`}
    >
      <TriangleAlert aria-hidden className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} strokeWidth={1.75} />
      Crítico
    </span>
  );
}
