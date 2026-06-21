"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Award, Check, RotateCcw, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useProfile } from "./ProfileProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ghlConversationUrl } from "@/lib/ghl-link";
import type { CertificadoItem } from "@/app/api/certificados/route";

// Módulo Certificados: reclamos de asistentes que dicen no haber recibido el
// certificado/diploma de una masterclass. El agente los deriva con la categoría
// `reclamo_certificado`; el equipo toma la conversación, reenvía el certificado
// y marca el reclamo como atendido. Mismo patrón que /interventions, pero con su
// propia bandeja (estos reclamos se excluyen de Derivaciones).

type StatusFilter = "pending" | "resolved" | "all";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Pendientes" },
  { key: "resolved", label: "Atendidos" },
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

export function CertificadosList() {
  const router = useRouter();
  const { profile } = useProfile();
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<CertificadoItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async (status: StatusFilter) => {
    try {
      const r = await fetch(`/api/certificados?status=${status}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar los reclamos");
        return;
      }
      setError(null);
      setItems(j.items as CertificadoItem[]);
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    setItems(null);
    void load(filter);
  }, [filter, load]);

  // Realtime: refrescar cuando entra un reclamo nuevo o cambia su estado.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("certificados-inbox")
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
      const r = await fetch(`/api/certificados/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolved, resolvedBy: profile?.id ?? null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? "No se pudo actualizar el reclamo");
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
          Reclamos de certificados
        </h1>
        {items && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {items.length} reclamo{items.length === 1 ? "" : "s"}
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
          Cargando reclamos…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Award className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
            No hay reclamos {filter !== "all" ? FILTERS.find((f) => f.key === filter)?.label.toLowerCase() : ""}
          </p>
          <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
            Cuando alguien reclame que no le llegó su certificado, aparece acá.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const isResolved = it.resolvedAt !== null;
            const busy = busyId === it.id;
            return (
              <article
                key={it.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
                    <Award className="h-3.5 w-3.5 text-gold" strokeWidth={1.75} />
                    {it.conversation?.displayName ?? "Reclamo de certificado"}
                  </span>
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
                    Atendido por {it.resolvedByName ?? "el equipo"}
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
                      Marcar atendido
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
