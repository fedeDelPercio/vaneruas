import { Flag } from "lucide-react";

// Pills de estado de una conversación: los de la cola de /revision, extraídos
// para que la lista de /wa use exactamente los mismos. El tag "Crítico" es
// aparte (CriticalPill), porque va pegado al nombre.
//
//   - Comprobante: comprobante pendiente de aprobar (dorado).
//   - Título: título profesional sin revisar (neutro).
//   - Retenido por título: comprobante que espera validar el título (warn).
//   - Derivada: derivaciones abiertas al equipo, sin contar las de pago (warn,
//     con la bandera de siempre).

export function KindPill({ kind, count = 1 }: { kind: "comprobante" | "titulo"; count?: number }) {
  const label = kind === "comprobante" ? "Comprobante" : "Título";
  return (
    <span
      title={
        kind === "comprobante"
          ? count > 1
            ? `${count} pagos distintos esperando aprobación`
            : "Comprobante esperando aprobación"
          : count > 1
            ? `${count} títulos para revisar`
            : "Título profesional para revisar"
      }
      className={`badge-pill shrink-0 ${
        kind === "comprobante"
          ? "border-gold/30 bg-gold/[0.06] text-gold-fg dark:text-gold"
          : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300"
      }`}
    >
      {label}
      {/* Sin número en "Comprobante": varias imágenes del mismo pago son un
          solo comprobante (grouping.ts) y el número confundía. */}
      {kind === "titulo" && count > 1 && <span className="font-mono tabular-nums opacity-70">{count}</span>}
    </span>
  );
}

export function AwaitingTitlePill() {
  return (
    <span
      title="El comprobante espera a que se valide el título profesional"
      className="badge-pill shrink-0 border-warn/40 bg-warn/10 text-warn-fg dark:text-warn"
    >
      Retenido por título
    </span>
  );
}

export function InterventionPill({ count }: { count: number }) {
  return (
    <span
      title={count === 1 ? "Intervención abierta" : `${count} intervenciones abiertas`}
      className="badge-pill shrink-0 border-warn/40 bg-warn/10 text-warn-fg dark:text-warn"
    >
      <Flag aria-hidden className="h-2.5 w-2.5" strokeWidth={2} />
      Derivada
      {count > 1 && <span className="font-mono tabular-nums opacity-70">{count}</span>}
    </span>
  );
}

/** Fila de pills con todo lo pendiente de una conversación (lista de /wa). */
export function ConversationStatusPills({
  comprobantes,
  titulos,
  awaitingTitle,
  derivations,
  className = "",
}: {
  comprobantes: number;
  titulos: number;
  awaitingTitle: boolean;
  derivations: number;
  className?: string;
}) {
  if (!comprobantes && !titulos && !awaitingTitle && !derivations) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {comprobantes > 0 && <KindPill kind="comprobante" count={comprobantes} />}
      {titulos > 0 && <KindPill kind="titulo" count={titulos} />}
      {awaitingTitle && <AwaitingTitlePill />}
      {derivations > 0 && <InterventionPill count={derivations} />}
    </span>
  );
}
