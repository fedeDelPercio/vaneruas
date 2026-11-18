import { ClipboardCheck, Hand, TriangleAlert } from "lucide-react";

// Pills de estado de una conversación, compartidos por la lista de /wa y la
// cola de /revision. Cada uno es el gemelo de un chip de filtro de /wa: mismo
// ícono y mismo color (D-66).
//
//   - Aprobación (amarillo, ClipboardCheck = filtro "Falta aprobar"):
//     comprobante o título esperando aprobación. Cubre también el comprobante
//     retenido por título (va en el title).
//   - Derivada (naranja, Hand = filtro "Derivadas"): derivaciones abiertas al
//     equipo, sin contar las de pago.
//   - Crítico (rojo, TriangleAlert = filtro "Críticos"): tag del clasificador.
//
// Compactos (10px, sentence case) para que los tres entren en una sola línea
// en la columna angosta de la lista: la fila no hace wrap y el nombre es lo
// que trunca, no los pills.

export type StatusTone = "approval" | "derived" | "critical";

/**
 * Clases por color, compartidas con FilterChip (chips de filtro de /wa). Clases
 * literales para que Tailwind las encuentre.
 */
export const STATUS_TONE: Record<
  StatusTone,
  {
    /** Texto / ícono sobre fondo neutro. */
    text: string;
    /** Ícono solo (más saturado que el texto). */
    icon: string;
    /** Pill: borde + fondo tenue + texto. */
    pill: string;
    /** Chip con pendientes (inactivo): borde con el acento. */
    chipBorder: string;
    /** Chip activo: borde y fondo con el color. */
    chipActive: string;
  }
> = {
  approval: {
    text: "text-yellow-700 dark:text-yellow-400",
    icon: "text-yellow-600 dark:text-yellow-400",
    pill: "border-yellow-500/50 bg-yellow-400/10 text-yellow-700 dark:border-yellow-400/40 dark:text-yellow-400",
    chipBorder: "border-yellow-500/50 dark:border-yellow-400/40",
    chipActive:
      "border-yellow-500 bg-yellow-400/15 text-neutral-900 dark:border-yellow-400 dark:bg-yellow-400/15 dark:text-neutral-50",
  },
  derived: {
    text: "text-orange-700 dark:text-orange-400",
    icon: "text-orange-600 dark:text-orange-500",
    pill: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:border-orange-500/40 dark:text-orange-400",
    chipBorder: "border-orange-500/50 dark:border-orange-500/40",
    chipActive:
      "border-orange-600 bg-orange-500/15 text-neutral-900 dark:border-orange-500 dark:bg-orange-500/15 dark:text-neutral-50",
  },
  critical: {
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-600 dark:text-red-500",
    pill: "border-red-500/50 bg-red-500/10 text-red-700 dark:border-red-500/40 dark:text-red-400",
    chipBorder: "border-red-500/50 dark:border-red-500/40",
    chipActive:
      "border-red-600 bg-red-500/15 text-neutral-900 dark:border-red-500 dark:bg-red-500/15 dark:text-neutral-50",
  },
};

export const STATUS_ICON = {
  approval: ClipboardCheck,
  derived: Hand,
  critical: TriangleAlert,
} as const;

const LABEL: Record<StatusTone, string> = {
  approval: "Aprobación",
  derived: "Derivada",
  critical: "Crítico",
};

export function StatusPill({
  tone,
  title,
  count,
}: {
  tone: StatusTone;
  title: string;
  /** Se muestra solo si es > 1. */
  count?: number;
}) {
  const Icon = STATUS_ICON[tone];
  return (
    <span
      title={title}
      data-status-pill={tone}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-medium leading-[14px] ${STATUS_TONE[tone].pill}`}
    >
      <Icon aria-hidden className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
      {LABEL[tone]}
      {count !== undefined && count > 1 && (
        <span className="font-mono tabular-nums opacity-70">{count}</span>
      )}
    </span>
  );
}

function approvalTitle(comprobantes: number, titulos: number, awaitingTitle: boolean): string {
  const parts: string[] = [];
  if (comprobantes > 0) {
    parts.push(
      comprobantes > 1 ? `${comprobantes} pagos distintos esperando aprobación` : "Comprobante esperando aprobación",
    );
  }
  if (titulos > 0) parts.push(titulos > 1 ? `${titulos} títulos para revisar` : "Título profesional para revisar");
  if (awaitingTitle) parts.push("el pago está retenido hasta validar el título");
  return parts.join(" · ");
}

/**
 * Fila de pills con todo lo pendiente de una conversación: Aprobación,
 * Derivada, Crítico, en ese orden y en una sola línea.
 */
export function ConversationStatusPills({
  comprobantes,
  titulos,
  awaitingTitle,
  derivations,
  critical = null,
  className = "",
}: {
  comprobantes: number;
  titulos: number;
  awaitingTitle: boolean;
  derivations: number;
  /** Tag "Crítico" (null = no lo tiene). */
  critical?: { reason: string | null } | null;
  className?: string;
}) {
  const approval = comprobantes > 0 || titulos > 0 || awaitingTitle;
  if (!approval && !derivations && !critical) return null;
  return (
    <span className={`flex min-w-0 flex-nowrap items-center gap-1 ${className}`}>
      {approval && <StatusPill tone="approval" title={approvalTitle(comprobantes, titulos, awaitingTitle)} />}
      {derivations > 0 && (
        <StatusPill
          tone="derived"
          count={derivations}
          title={derivations === 1 ? "Intervención abierta" : `${derivations} intervenciones abiertas`}
        />
      )}
      {critical && (
        <StatusPill tone="critical" title={critical.reason ? `Crítico: ${critical.reason}` : "Conversación crítica"} />
      )}
    </span>
  );
}
