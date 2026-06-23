"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  UserPlus,
  Check,
  RotateCcw,
  ArrowRight,
  MessageSquareQuote,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ghlConversationUrl } from "@/lib/ghl-link";
import { ContactStrip } from "./ContactStrip";
import type { AgendarItem } from "@/app/api/agendar/route";

// Módulo Agendar: worklist de contactos de WhatsApp que el equipo todavía tiene
// que dar de alta (en GHL y, según el caso, en grupos de WhatsApp). El agente
// les pide nombre y apellido; el equipo lo lee del chat, los registra y los
// tilda como agendados.

type StatusFilter = "pending" | "done" | "all";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Por agendar" },
  { key: "done", label: "Agendados" },
  { key: "all", label: "Todos" },
];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AgendarList() {
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<AgendarItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async (status: StatusFilter) => {
    try {
      const r = await fetch(`/api/agendar?status=${status}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar los contactos");
        return;
      }
      setError(null);
      setItems(j.items as AgendarItem[]);
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    setItems(null);
    void load(filter);
  }, [filter, load]);

  // Realtime: refrescar cuando entra una conversación nueva o cambia el flag.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("agendar-conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => void load(filterRef.current),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function setAgendada(id: string, agendada: boolean) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/agendar/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agendada }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? "No se pudo actualizar el contacto");
        return;
      }
      await load(filterRef.current);
    } catch {
      setError("Error de red al actualizar");
    } finally {
      setBusyId(null);
    }
  }

  if (error && items === null) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-500">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between pb-3">
        <h1 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          Agendar
        </h1>
        {items && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {items.length} contacto{items.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <p className="mb-4 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        Contactos de WhatsApp para dar de alta en GoHighLevel y, según el caso, en
        los grupos de WhatsApp. El nombre y apellido lo pide la asistente en el
        chat. Cuando los agendes, marcalos como agendados.
      </p>

      <div className="mb-4 flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-2.5 py-1.5 text-[12px] transition ${
              filter === f.key
                ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-neutral-500 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          Cargando contactos…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <UserPlus className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
            No hay contactos {filter === "pending" ? "por agendar" : filter === "done" ? "agendados" : ""}
          </p>
          <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
            Cuando alguien nuevo escriba por WhatsApp, aparece acá para agendarlo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const busy = busyId === it.conversationId;
            const ghlUrl = ghlConversationUrl({
              id: it.conversationId,
              source: it.source,
              externalId: it.externalId,
            });
            return (
              <article
                key={it.conversationId}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
                    <UserPlus className="h-3.5 w-3.5 text-gold" strokeWidth={1.75} />
                    {it.displayName}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    {fmtDateTime(it.createdAt)}
                  </span>
                </div>

                {/* Nombre del contacto de WhatsApp + teléfono (wa.me). */}
                <ContactStrip conversation={{ displayName: it.displayName, phone: it.phone }} />

                {/* Últimos mensajes del contacto: ahí suele estar el nombre y
                    apellido que pidió la asistente. */}
                {it.lastMessages.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                      Últimos mensajes del contacto
                    </p>
                    <div className="space-y-1.5">
                      {it.lastMessages.map((m, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40"
                        >
                          <MessageSquareQuote
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500"
                            strokeWidth={1.75}
                          />
                          <p className="text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                            {m}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                  {ghlUrl && (
                    <a
                      href={ghlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      Ver en GHL
                      <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  )}

                  {it.agendada ? (
                    <button
                      onClick={() => void setAgendada(it.conversationId, false)}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                      Volver a pendiente
                    </button>
                  ) : (
                    <button
                      onClick={() => void setAgendada(it.conversationId, true)}
                      disabled={busy}
                      className="flex items-center gap-1.5 btn-gold"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                      ) : (
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                      Marcar como agendada
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
