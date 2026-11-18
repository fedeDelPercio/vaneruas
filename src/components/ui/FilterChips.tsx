import type { ComponentType, ReactNode } from "react";

// Chips de filtro del panel: un solo look para todas las listas (/wa,
// /payments). Reglas:
// - Misma caja para todos: alto 30px, borde, rounded-lg (botón de marca),
//   text-[12px] font-medium, ícono lucide opcional de 3.5.
// - Un solo estado activo (relleno oscuro / claro en dark) y un solo estado
//   inactivo (borde neutro, texto secundario, hover sutil). Nada de colores
//   por filtro.
// - Contador en Geist Mono tabular. Si el chip marca `attention` y tiene algo
//   pendiente, el número va en dorado (el acento de marca); es la única señal
//   de urgencia y es igual para todos los chips que la usen.

type IconType = ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

export function FilterChips({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  /** Nombre accesible del grupo (p.ej. "Filtros"). */
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {children}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  label,
  title,
  Icon,
  leading,
  count,
  attention = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
  /** Ícono lucide opcional. */
  Icon?: IconType;
  /** Alternativa al ícono (p.ej. un dot de color de evento). */
  leading?: ReactNode;
  /** Contador; `null`/`undefined` no lo muestra. */
  count?: number | null;
  /** Resalta el contador en dorado cuando es > 0 (algo pendiente). */
  attention?: boolean;
}) {
  const flagged = attention && !active && (count ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-medium transition ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-950"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
      }`}
    >
      {Icon && <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />}
      {!Icon && leading}
      <span>{label}</span>
      {count !== null && count !== undefined && (
        <span
          className={`min-w-3 text-center font-mono text-[10.5px] tabular-nums ${
            active
              ? "opacity-70"
              : flagged
                ? "text-gold-fg dark:text-gold"
                : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
