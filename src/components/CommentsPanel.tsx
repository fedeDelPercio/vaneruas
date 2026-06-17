"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  X,
  ArrowUp,
  Loader2,
  Check,
  X as XIcon,
  CornerDownRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Comment } from "@/lib/supabase/types";
import { useProfile } from "./ProfileProvider";
import { Avatar } from "./Avatar";
import type { CommentTarget } from "./ConversationPanel";

// Side-panel de actividad: muestra reacciones (positive/negative) y notas
// firmadas por perfil. En modo "conversation" agrega tambien la actividad
// de cada mensaje de la conversacion, con un snippet clickeable que hace
// scroll al mensaje correspondiente.

// Snippet chico de mensaje para mostrar al lado de cada entry message-level.
type MessageSnippet = { content: string; role: string };

export function CommentsPanel({
  target,
  onClose,
}: {
  target: CommentTarget;
  onClose: () => void;
}) {
  const { profile } = useProfile();
  const [comments, setComments] = useState<Comment[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  // Mapa id -> snippet para renderizar el contexto de cada entrada que
  // apunta a un mensaje. Vacio cuando target.type === "message".
  const [messageMap, setMessageMap] = useState<Record<string, MessageSnippet>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const loadAuthors = useCallback(async () => {
    const { data } = await getSupabaseBrowserClient().from("profiles").select("id, name");
    const map: Record<string, string> = {};
    (data ?? []).forEach((p) => {
      map[p.id] = p.name;
    });
    setAuthors(map);
  }, []);

  const refetch = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();

    if (target.type === "message") {
      // Caso simple: actividad de un mensaje puntual.
      const { data } = await supabase
        .from("comments")
        .select("*")
        .eq("target_type", "message")
        .eq("target_id", target.id)
        .order("created_at", { ascending: true });
      setComments(data ?? []);
      setMessageMap({});
      return;
    }

    // Conversacion: traemos los mensajes de la conversacion + comments de la
    // conversacion + comments de cada mensaje. Despues ordenamos por tiempo.
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, content, role")
      .eq("conversation_id", target.id);
    const map: Record<string, MessageSnippet> = {};
    const messageIds: string[] = [];
    for (const m of msgs ?? []) {
      map[m.id] = { content: m.content, role: m.role };
      messageIds.push(m.id);
    }
    setMessageMap(map);

    const convPromise = supabase
      .from("comments")
      .select("*")
      .eq("target_type", "conversation")
      .eq("target_id", target.id);
    const msgPromise =
      messageIds.length > 0
        ? supabase
            .from("comments")
            .select("*")
            .eq("target_type", "message")
            .in("target_id", messageIds)
        : Promise.resolve({ data: [] as Comment[] });
    const [convRes, msgRes] = await Promise.all([convPromise, msgPromise]);
    const all = [...(convRes.data ?? []), ...(msgRes.data ?? [])];
    all.sort((a, b) => a.created_at.localeCompare(b.created_at));
    setComments(all);
  }, [target]);

  useEffect(() => {
    void loadAuthors();
    void refetch();
    const supabase = getSupabaseBrowserClient();
    // Suscribimos a TODOS los cambios en comments (RLS scopea por
    // client_slug). Refetchemos en cada evento — es barato y simple.
    const channel = supabase
      .channel(`comments-panel-${target.type}-${target.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments" },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [target, refetch, loadAuthors]);

  async function send() {
    const content = text.trim();
    if (!content || !profile || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: target.type,
          target_id: target.id,
          author_id: profile.id,
          content,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "No se pudo comentar");
        return;
      }
      setText("");
    } catch {
      toast.error("Error de red");
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    // Optimistic: sacamos del state inmediato para feedback rápido. Si la
    // request falla, restauramos y mostramos toast. El realtime no es
    // confiable solo (RLS, latencia), así que el optimistic da UX consistente.
    const prev = comments;
    setComments(prev.filter((c) => c.id !== id));
    try {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setComments(prev);
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "No se pudo borrar el comentario");
      }
    } catch {
      setComments(prev);
      toast.error("Error de red al borrar");
    }
  }

  // Scroll al mensaje al que apunta la entrada + highlight breve.
  function scrollToMessage(messageId: string) {
    const el = document.getElementById(`message-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlight-message");
    window.setTimeout(() => el.classList.remove("highlight-message"), 1500);
  }

  // Renderiza el snippet clickeable del mensaje al que apunta una entrada.
  function MessageContext({ messageId }: { messageId: string }) {
    const snippet = messageMap[messageId];
    if (!snippet) return null;
    const trimmed =
      snippet.content.length > 80
        ? snippet.content.slice(0, 80).trim() + "…"
        : snippet.content;
    const roleLabel =
      snippet.role === "user"
        ? "cliente"
        : snippet.role === "assistant"
          ? "agente"
          : "sistema";
    return (
      <button
        onClick={() => scrollToMessage(messageId)}
        className="mt-1 flex w-full items-start gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-left text-[11px] text-neutral-500 transition hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        title="Ir al mensaje"
      >
        <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
        <span className="flex-1">
          <span className="font-medium text-neutral-400 dark:text-neutral-500">
            sobre el mensaje del {roleLabel}:
          </span>{" "}
          <span className="italic">{trimmed}</span>
        </span>
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-neutral-900/40 md:hidden"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-40 flex h-full w-full max-w-sm flex-col border-l border-neutral-200 bg-white md:static md:z-auto md:w-80 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Actividad
            </p>
            <p className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
              {target.type === "conversation"
                ? "reacciones y notas de la conversación"
                : "reacciones y notas del mensaje"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-3">
          {comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">
              Sin actividad todavía.
            </p>
          ) : (
            comments.map((c) => {
              const authorName = authors[c.author_id] ?? "Perfil";
              const when = formatDistanceToNow(new Date(c.created_at), {
                addSuffix: true,
                locale: es,
              });
              const showsMessageContext =
                target.type === "conversation" && c.target_type === "message";

              // Reacciones: una linea compacta con el icono coloreado.
              // Si la reaccion ademas trae content (el user dejo un comentario
              // junto con el voto), lo renderizamos abajo como un bubble chico.
              if (c.kind === "positive" || c.kind === "negative") {
                const isPositive = c.kind === "positive";
                return (
                  <div key={c.id} className="group flex gap-2.5">
                    <Avatar name={authorName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                        <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                          {authorName}
                        </span>
                        <span className="text-neutral-400 dark:text-neutral-500">
                          marcó como
                        </span>
                        <span
                          className={`inline-flex h-4 w-4 items-center justify-center rounded ${
                            isPositive
                              ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                              : "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                          }`}
                        >
                          {isPositive ? (
                            <Check className="h-3 w-3" strokeWidth={2.5} />
                          ) : (
                            <XIcon className="h-3 w-3" strokeWidth={2.5} />
                          )}
                        </span>
                        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                          · {when}
                        </span>
                        <button
                          onClick={() => remove(c.id)}
                          className="ml-auto text-neutral-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100 focus:opacity-100 dark:text-neutral-600 dark:hover:text-rose-400"
                          aria-label="Borrar reacción"
                          title="Borrar reacción"
                        >
                          <XIcon className="h-3 w-3" strokeWidth={1.75} />
                        </button>
                      </div>
                      {c.content && (
                        <p className="mt-1 whitespace-pre-wrap rounded-md rounded-tl-sm bg-neutral-100 px-2.5 py-1.5 text-[13px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                          {c.content}
                        </p>
                      )}
                      {showsMessageContext && (
                        <MessageContext messageId={c.target_id} />
                      )}
                    </div>
                  </div>
                );
              }
              // Notas: bubble con contenido.
              return (
                <div key={c.id} className="group flex gap-2.5">
                  <Avatar name={authorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                        {authorName}
                      </span>
                      <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                        {when}
                      </span>
                      <span className="ml-1 inline-flex h-4 items-center rounded bg-neutral-100 px-1.5 text-[9px] uppercase tracking-wider text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        nota
                      </span>
                      <button
                        onClick={() => remove(c.id)}
                        className="ml-auto text-neutral-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100 focus:opacity-100 dark:text-neutral-600 dark:hover:text-rose-400"
                        aria-label="Borrar comentario"
                        title="Borrar comentario"
                      >
                        <XIcon className="h-3 w-3" strokeWidth={1.75} />
                      </button>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap rounded-lg rounded-tl-sm bg-neutral-100 px-2.5 py-1.5 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {c.content}
                    </p>
                    {showsMessageContext && (
                      <MessageContext messageId={c.target_id} />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex items-end gap-2 rounded-md border border-neutral-200 bg-white p-1.5 pl-3 transition focus-within:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-600">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={
                target.type === "conversation"
                  ? "Nota sobre toda la conversación…"
                  : "Nota sobre este mensaje…"
              }
              className="scroll-thin max-h-28 min-h-[32px] flex-1 resize-none self-center bg-transparent py-1.5 text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />
            <button
              onClick={send}
              disabled={sending || !text.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-gold to-gold-start text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Enviar comentario"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
