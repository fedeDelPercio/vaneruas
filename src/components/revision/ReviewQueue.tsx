"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { SearchField } from "../SearchField";
import { formatPhone } from "@/lib/search";
import { eventBySlug } from "@/lib/payments/event-match";
import { fmtAge, fmtAmount, type ReviewItem } from "./review-items";
import { CriticalPill } from "../CriticalPill";
import { AwaitingTitlePill, InterventionPill, KindPill } from "../StatusPills";

// Columna izquierda de /revision: la cola de pendientes (comprobantes y
// títulos), con buscador server-side (el mismo ?q= de Aprobaciones).

export function ReviewQueue({
  items,
  error,
  query,
  onQueryChange,
  searching,
  selectedId,
  onSelect,
  interventions,
  critical = {},
  onRetry,
}: {
  items: ReviewItem[] | null;
  error: string | null;
  query: string;
  onQueryChange: (v: string) => void;
  searching: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** id de conversación → derivaciones abiertas. */
  interventions: Record<string, number>;
  /** id de conversación → motivo del tag "Crítico". */
  critical?: Record<string, string | null>;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
            Pendientes
          </h2>
          {items && (
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              {items.length}
            </span>
          )}
        </div>
        <SearchField value={query} onChange={onQueryChange} className="mt-3" />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-neutral-200 dark:border-neutral-800">
        {error && !items ? (
          <div className="px-4 py-10 text-center text-[12px] text-neutral-500">
            {error}{" "}
            <button onClick={onRetry} className="underline underline-offset-2">
              Reintentar
            </button>
          </div>
        ) : !items ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> Cargando…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <CheckCircle2 className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
              {searching ? "Sin pendientes para esa búsqueda" : "No hay aprobaciones pendientes"}
            </p>
            <p className="text-[12px] text-neutral-500">
              {searching ? "Probá con otro nombre o teléfono" : "Los nuevos comprobantes aparecen acá solos"}
            </p>
          </div>
        ) : (
          <ul className="py-1">
            {items.map((it) => (
              <QueueRow
                key={it.id}
                item={it}
                active={it.id === selectedId}
                interventions={it.conversationId ? interventions[it.conversationId] ?? 0 : 0}
                critical={it.conversationId && it.conversationId in critical ? { reason: critical[it.conversationId] ?? null } : null}
                onSelect={() => onSelect(it.id)}
              />
            ))}
          </ul>
        )}
        {error && items && (
          <p className="px-4 py-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  item,
  active,
  interventions,
  critical,
  onSelect,
}: {
  item: ReviewItem;
  active: boolean;
  interventions: number;
  critical: { reason: string | null } | null;
  onSelect: () => void;
}) {
  const phone = formatPhone(item.phone);
  const ev = item.kind === "comprobante" ? eventBySlug(item.eventSlug) : null;
  const amount = fmtAmount(item.amount, item.currency);
  const images = item.file.images?.length ?? 0;
  const meta = [
    ev?.shortLabel ?? (item.kind === "comprobante" ? "Sin evento" : null),
    amount,
    images > 1 ? `${images} imágenes` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={`relative flex w-full flex-col gap-1 px-4 py-2.5 text-left transition ${
          active
            ? "bg-neutral-100 dark:bg-neutral-900"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
        }`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gradient-to-b from-gold-start to-gold"
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
              {item.name}
            </span>
            {critical && <CriticalPill compact reason={critical.reason} />}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {fmtAge(item.createdAt)}
          </span>
        </div>
        {phone && (
          <span className="truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{phone}</span>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <KindPill kind={item.kind} />
          {item.awaitingTitle && <AwaitingTitlePill />}
          {interventions > 0 && <InterventionPill count={interventions} />}
          {meta && (
            <span className="truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">{meta}</span>
          )}
        </div>
      </button>
    </li>
  );
}
