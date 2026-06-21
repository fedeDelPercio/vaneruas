"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Inbox, Check, RotateCcw, ArrowRight, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useProfile } from "./ProfileProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ghlConversationUrl } from "@/lib/ghl-link";
import type { InterventionItem } from "@/app/api/interventions/route";

// Bandeja de derivaciones al equipo: notificaciones del agente que necesitan
// intervención humana (todo menos comprobantes de pago, que viven en /payments).
// El equipo toma la conversación y marca la derivación como atendida.

type StatusFilter = "pending" | "resolved" | "all";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Pendientes" },
  { key: "resolved", label: "Atendidas" },
  { key: "all", label: "Todas" },
];

// Etiquetas humanas de las categorías. Fallback: humaniza el snake_case.
const CATEGORY_LABELS: Record<string, string> = {
  interes_compra: "Interés de compra",
  cliente_existente: "Cliente existente",
  fuera_de_conocimiento: "Fuera de conocimiento",
  escalado_manual: "Escalado manual",
  falla_tecnica: "Falla técnica",
  arquitecto_desarrollador: "Arquitecto / desarrollador",
  cantidad_equipos: "Cantidad de equipos",
};

function categoryLabel(c: string): string {
  if (CATEGORY_LABELS[c]) return CATEGORY_LABELS[c];
  return c
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Las categorías "duras" (problema, no oportunidad) llevan un dot warn.
const ALERT_CATEGORIES = new Set(["escalado_manual", "falla_tecnica"]);

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InterventionsList() {
  const router = useRouter();
  const { profile } = useProfile();
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<InterventionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async (status: StatusFilter) => {
    try {
      const r = await fetch(`/api/interventions?status=${status}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar las derivaciones");
        return;
      }
      setError(null);
      setItems(j.items as InterventionItem[]);
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    setItems(null);
    void load(filter);
  }, [filter, load]);

  // Realtime: refrescar cuando entra una derivación nueva o cambia su estado.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("agent-notifications-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_notifications" },
        () => void load(filterRef.current),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function setResolved(id: string, resolved: boolean) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/interventions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolved, resolvedBy: profile?.id ?? null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? "No se pudo actualizar la derivación");
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
          Derivaciones al equipo
        </h1>
        {items && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {items.length} derivaci{items.length === 1 ? "ón" : "ones"}
          </span>
        )}
      </div>

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
          Cargando derivaciones…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Inbox className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
            No hay derivaciones {filter !== "all" ? FILTERS.find((f) => f.key === filter)?.label.toLowerCase() : ""}
          </p>
          <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
            Cuando el agente derive una conversación al equipo, aparece acá.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const isResolved = it.resolvedAt !== null;
            const busy = busyId === it.id;
            const isAlert = ALERT_CATEGORIES.has(it.category);
            return (
              <article
                key={it.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
                      {isAlert && (
                        <AlertTriangle className="h-3.5 w-3.5 text-warn" strokeWidth={1.75} />
                      )}
                      {categoryLabel(it.category)}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    {fmtDateTime(it.createdAt)}
                  </span>
                </div>

                {it.summary && (
                  <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                    {it.summary}
                  </p>
                )}

                {isResolved && (
                  <p className="mt-2 text-[12px] text-ok">
                    Atendida por {it.resolvedByName ?? "el equipo"}
                    {it.resolvedAt ? ` · ${fmtDateTime(it.resolvedAt)}` : ""}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                  {it.conversation && (
                    <button
                      onClick={() => {
                        const url = ghlConversationUrl(it.conversation);
                        if (url) window.open(url, "_blank", "noopener,noreferrer");
                        else router.push(`/conversations?id=${it.conversation!.id}`);
                      }}
                      className="mr-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      Ver conversación
                      <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  )}

                  {isResolved ? (
                    <button
                      onClick={() => void setResolved(it.id, false)}
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
                      onClick={() => void setResolved(it.id, true)}
                      disabled={busy}
                      className="flex items-center gap-1.5 btn-gold"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                      ) : (
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                      Marcar atendida
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
