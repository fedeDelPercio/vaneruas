"use client";

import { createContext, useContext, type ComponentType, type ReactNode } from "react";

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
// - `columns`: grilla de columnas iguales; todos los chips del grupo quedan del
//   mismo alto y ancho (label a la izquierda, contador a la derecha).
// - `FilterPanel`: contenedor con título ("Filtros") para agrupar uno o más
//   grupos de chips en una tarjeta sutil.

type IconType = ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

/** ¿El chip vive en una grilla? Ahí ocupa toda la celda. */
const GridContext = createContext(false);

const GRID_COLS: Record<2 | 3 | 4 | 5, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-3 sm:grid-cols-5",
};

export function FilterChips({
  children,
  label,
  columns,
  className = "",
}: {
  children: ReactNode;
  /** Nombre accesible del grupo (p.ej. "Filtros"). */
  label: string;
  /** Grilla de columnas iguales (todos los chips del mismo tamaño). Sin esto, wrap. */
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  return (
    <GridContext.Provider value={Boolean(columns)}>
      <div
        role="group"
        aria-label={label}
        className={`${
          columns ? `grid ${GRID_COLS[columns]} gap-1.5` : "flex flex-wrap items-center gap-1.5"
        } ${className}`}
      >
        {children}
      </div>
    </GridContext.Provider>
  );
}

/**
 * Tarjeta sutil que agrupa los filtros de una lista, con su título. Puede
 * llevar varios grupos de chips (p.ej. por estado y por evento).
 */
export function FilterPanel({
  title = "Filtros",
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-xl border border-neutral-200 bg-neutral-50/60 p-2.5 dark:border-neutral-800 dark:bg-neutral-900/40 ${className}`}
    >
      <h3 className="mb-2 px-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
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
  const inGrid = useContext(GridContext);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`${inGrid ? "flex w-full min-w-0" : "inline-flex shrink-0"} h-[30px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-medium transition ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-950"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
      }`}
    >
      {Icon && <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />}
      {!Icon && leading}
      <span className={inGrid ? "min-w-0 truncate" : undefined}>{label}</span>
      {count !== null && count !== undefined && (
        <span
          className={`${inGrid ? "ml-auto " : ""}min-w-3 text-center font-mono text-[10.5px] tabular-nums ${
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
