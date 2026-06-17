"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessagesSquare, ArrowRight } from "lucide-react";
import { Avatar } from "./Avatar";
import type { FeedbackItem } from "@/app/api/feedback/route";

// Lista de feedback (comentarios reales del equipo sobre conversaciones /
// mensajes). Cada item tiene un botón "Abrir conversación" que deep-linkea
// a /conversations?id=X&highlight=Y; ConversationPanel detecta el highlight
// y scrollea + resalta el mensaje por 2.5s.

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function kindLabel(k: FeedbackItem["kind"]): string {
  return k === "note" ? "Nota" : k === "negative" ? "Negativo" : "Positivo";
}

function kindClasses(k: FeedbackItem["kind"]): string {
  if (k === "negative") {
    return "border-red-200/70 bg-red-50/60 text-red-700 dark:border-red-500/30 dark:bg-red-500/[0.06] dark:text-red-300";
  }
  if (k === "positive") {
    return "border-ok/30 bg-ok/[0.06] text-ok dark:border-ok/30 dark:bg-ok/[0.06] dark:text-ok";
  }
  return "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400";
}

export function FeedbackList() {
  const router = useRouter();
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/feedback", { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(j.error ?? "No se pudo cargar el feedback");
          return;
        }
        setItems(j.items as FeedbackItem[]);
      } catch {
        if (!cancelled) setError("Error de red");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openConversation(item: FeedbackItem) {
    if (!item.conversation) return;
    const params = new URLSearchParams({ id: item.conversation.id });
    if (item.targetMessageId) params.set("highlight", item.targetMessageId);
    router.push(`/conversations?${params.toString()}`);
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-500">
        {error}
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        Cargando feedback…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <MessagesSquare
          className="h-6 w-6 text-neutral-300 dark:text-neutral-700"
          strokeWidth={1.5}
        />
        <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
          Sin feedback todavía
        </p>
        <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
          Los comentarios que dejen sobre conversaciones o mensajes aparecen acá.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between pb-2">
        <h1 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          Feedback
        </h1>
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          {items.length} comentario{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
        >
          {/* Header: autor + cuándo + kind */}
          <div className="flex items-center gap-2.5">
            <Avatar name={item.author?.name ?? "?"} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                {item.author?.name ?? "anónimo"}
              </p>
              <p className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                {fmtDate(item.createdAt)}
                {item.author?.role ? ` · ${item.author.role}` : ""}
              </p>
            </div>
            <span
              className={`shrink-0 badge-pill ${kindClasses(
                item.kind,
              )}`}
            >
              {kindLabel(item.kind)}
            </span>
          </div>

          {/* Conversación + msg snippet */}
          <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
            <p className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              {item.conversation?.displayName ?? "conversación desconocida"}
              {item.conversation?.source ? ` · ${item.conversation.source}` : ""}
              {item.targetType === "message" ? " · sobre mensaje" : " · sobre la conversación"}
            </p>
            {item.targetMessageSnippet && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  {item.targetMessageRole === "user" ? "usuario" : "agente"}:
                </span>{" "}
                <span className="italic">«{item.targetMessageSnippet}»</span>
              </p>
            )}
          </div>

          {/* Comment body */}
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-200">
            {item.content}
          </p>

          {/* Footer: abrir conversación */}
          {item.conversation && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => openConversation(item)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Abrir conversación
                <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
