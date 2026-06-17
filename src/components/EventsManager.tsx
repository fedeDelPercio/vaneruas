"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
  CreditCard,
  ArrowRightLeft,
  Globe,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  kindLabel,
  cardPriceLabel,
  transferPriceLabel,
  internationalPriceLabel,
} from "@/lib/events/format";
import type { EventItem } from "@/app/api/events/route";
import { EventFormModal } from "./EventFormModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Pill de estado: acento solo como dot + texto, nunca fondo de color (design
// system). Activo = emerald, borrador = neutro, archivado = muted.
function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { dot: string; text: string; label: string }> = {
    activo: {
      dot: "bg-ok",
      text: "text-neutral-700 dark:text-neutral-200",
      label: "Activo",
    },
    borrador: {
      dot: "bg-neutral-400 dark:bg-neutral-500",
      text: "text-neutral-500 dark:text-neutral-400",
      label: "Borrador",
    },
    archivado: {
      dot: "bg-neutral-300 dark:bg-neutral-700",
      text: "text-neutral-400 dark:text-neutral-500",
      label: "Archivado",
    },
  };
  const c = cfg[status] ?? cfg.borrador!;
  return (
    <span className={`flex items-center gap-1.5 text-[11.5px] ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function PriceRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CreditCard;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-neutral-600 dark:text-neutral-300">
      <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
      <span className="text-neutral-500 dark:text-neutral-500">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

export function EventsManager() {
  const [items, setItems] = useState<EventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [deleting, setDeleting] = useState<EventItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/events", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar los eventos");
        return;
      }
      setError(null);
      setItems(j.items as EventItem[]);
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: refrescar la lista cuando cambia la tabla.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("events-manager")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(ev: EventItem) {
    setEditing(ev);
    setFormOpen(true);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const r = await fetch(`/api/events/${deleting.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? "No se pudo borrar el evento");
        return;
      }
      setDeleting(null);
      await load();
    } catch {
      setError("Error de red");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
            Eventos
          </h1>
          <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-500">
            Masterclass y congresos que el agente comunica. Los activos con
            lanzamiento cumplido entran en la base de conocimiento
          </p>
        </div>
        <button
          onClick={openNew}
          className="btn-gold flex shrink-0 items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Nuevo evento
        </button>
      </div>

      <div className="mt-5">
        {error && items === null ? (
          <div className="py-16 text-center text-[13px] text-neutral-500">
            {error}
          </div>
        ) : items === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Cargando…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <CalendarDays className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
            <p className="text-[13px] text-neutral-500">Todavía no hay eventos</p>
            <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
              Creá una masterclass o el congreso para que el agente lo ofrezca
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((ev) => {
              const card = cardPriceLabel(ev.cardTotal, ev.cardInstallments);
              const transfer = transferPriceLabel(ev.transferPrice);
              const intl = internationalPriceLabel(ev.internationalPrice);
              const anyPrice = card || transfer || intl;
              return (
                <article
                  key={ev.id}
                  className="rounded-md border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                          {kindLabel(ev.kind)}
                        </span>
                        <StatusPill status={ev.status} />
                      </div>
                      <h2 className="mt-1 truncate text-[14px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
                        {ev.title}
                      </h2>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(ev)}
                        className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                        aria-label="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                      <button
                        onClick={() => setDeleting(ev)}
                        className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800 dark:hover:text-red-400"
                        aria-label="Borrar"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    <span>
                      Evento · {fmtDate(ev.eventAt)}
                      {ev.eventEndAt ? ` al ${fmtDate(ev.eventEndAt)}` : ""}
                    </span>
                    <span>Lanza · {fmtDate(ev.announceAt)}</span>
                  </div>

                  {anyPrice && (
                    <div className="mt-3 space-y-1 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                      {transfer && (
                        <PriceRow icon={ArrowRightLeft} label="Transferencia" value={transfer} />
                      )}
                      {card && <PriceRow icon={CreditCard} label="Tarjeta" value={card} />}
                      {intl && (
                        <PriceRow icon={Globe} label="Internacional" value={intl} />
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {formOpen && (
        <EventFormModal
          event={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            void load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title="Borrar evento"
          description={`Se va a eliminar "${deleting.title}". El agente dejará de comunicarlo. Esta acción no se puede deshacer.`}
          loading={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
