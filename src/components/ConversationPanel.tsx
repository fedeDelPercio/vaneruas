"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Loader2, Menu, Pencil } from "lucide-react";
import toast from "react-hot-toast";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CommentKind, Conversation, Message } from "@/lib/supabase/types";
import type { ViewMode } from "@/lib/profile";
import { useProfile } from "./ProfileProvider";
import { Avatar } from "./Avatar";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import {
  EMPTY_REACTION,
  type MessageReactionState,
} from "./MessageReactions";

// Objetivo de un hilo de comentarios (una conversacion entera o un mensaje).
export type CommentTarget = {
  type: "conversation" | "message";
  id: string;
  label: string;
};

// Panel de conversacion: mensajes + composer. Escucha Realtime para ver
// aparecer la respuesta del agente y el indicador "Agente pensando…".

export function ConversationPanel({
  conversationId,
  onOpenComments,
  onOpenSidebar,
}: {
  conversationId: string;
  onOpenComments: (target: CommentTarget) => void;
  onOpenSidebar: () => void;
}) {
  const { profile } = useProfile();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, MessageReactionState>>(
    {},
  );
  // viewMode se deriva del role: dev ve siempre la vista avanzada (con trace),
  // el cliente ve la vista simple. Sin toggle: la elección es por rol.
  const viewMode: ViewMode = profile?.role === "dev" ? "advanced" : "simple";
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Edit inline del display_name. Cancelacion via Escape o blur (escapeRef
  // marca que el blur viene de un cancel y no debe disparar save).
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cancelingNameRef = useRef(false);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.select();
    }
  }, [editingName]);

  function startEditName() {
    if (!conversation) return;
    setNameInput(conversation.display_name);
    cancelingNameRef.current = false;
    setEditingName(true);
  }

  function cancelEditName() {
    cancelingNameRef.current = true;
    setEditingName(false);
  }

  async function saveName() {
    if (cancelingNameRef.current) {
      cancelingNameRef.current = false;
      return;
    }
    if (!conversation) {
      setEditingName(false);
      return;
    }
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === conversation.display_name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo renombrar");
        return;
      }
      setConversation((c) => (c ? { ...c, display_name: trimmed } : c));
      setEditingName(false);
    } catch {
      toast.error("Error de red al renombrar");
    } finally {
      setSavingName(false);
    }
  }

  const refreshThinking = useCallback(async () => {
    const { count } = await getSupabaseBrowserClient()
      .from("agent_jobs")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .in("status", ["pending", "processing"]);
    setThinking((count ?? 0) > 0);
  }, [conversationId]);

  // Recarga las reacciones (positive/negative/note) de todos los mensajes
  // de la conversacion en una sola query.
  const refreshReactions = useCallback(
    async (messageIds: string[]) => {
      if (messageIds.length === 0) {
        setReactions({});
        return;
      }
      const { data } = await getSupabaseBrowserClient()
        .from("comments")
        .select("target_id, author_id, kind")
        .eq("target_type", "message")
        .in("target_id", messageIds);

      const map: Record<string, MessageReactionState> = {};
      for (const id of messageIds) map[id] = { ...EMPTY_REACTION };
      for (const c of data ?? []) {
        const entry = map[c.target_id];
        if (!entry) continue;
        if (c.kind === "positive") {
          entry.positiveCount++;
          if (c.author_id === profile?.id) entry.myKind = "positive";
        } else if (c.kind === "negative") {
          entry.negativeCount++;
          if (c.author_id === profile?.id) entry.myKind = "negative";
        } else if (c.kind === "note") {
          entry.noteCount++;
        }
      }
      setReactions(map);
    },
    [profile?.id],
  );

  // Submit del menú compacto: el usuario eligió sentimiento
  // (positive/negative/note=neutro) y opcionalmente está agregando texto. El
  // backend: si llega sin content para un positive/negative que ya existe,
  // hace toggle off; si llega con content, actualiza el comment existente o
  // crea uno nuevo. Note siempre acumula.
  const handleSubmitReaction = useCallback(
    async (messageId: string, kind: CommentKind, content: string | null) => {
      if (!profile) {
        toast.error("Necesitás un perfil para comentar.");
        return;
      }
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: "message",
          target_id: messageId,
          author_id: profile.id,
          kind,
          content,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "No se pudo registrar la reacción");
      }
    },
    [profile],
  );

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    setLoading(true);

    void (async () => {
      const [convRes, msgRes] = await Promise.all([
        supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle(),
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
      ]);
      if (!active) return;
      const msgs = msgRes.data ?? [];
      setConversation(convRes.data);
      setMessages(msgs);
      setLoading(false);
      void refreshThinking();
      void refreshReactions(msgs.map((m) => m.id));
    })();

    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            const next = [...prev, incoming];
            void refreshReactions(next.map((m) => m.id));
            return next;
          });
          void refreshThinking();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_jobs",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void refreshThinking(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments" },
        () => {
          // Refetch barato (consulta filtrada por target_id IN). El RLS por
          // client_slug limita el ruido a comments del cliente activo.
          setMessages((prev) => {
            void refreshReactions(prev.map((m) => m.id));
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, refreshThinking, refreshReactions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/80 px-4 py-3.5 backdrop-blur sm:px-6 dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onOpenSidebar}
            className="-ml-1 rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-100 md:hidden dark:text-neutral-400 dark:hover:bg-neutral-900"
            aria-label="Ver conversaciones"
          >
            <Menu className="h-4 w-4" strokeWidth={1.75} />
          </button>
          {conversation && <Avatar name={conversation.display_name} size="sm" />}
          <div className="min-w-0">
            {editingName ? (
              <input
                ref={nameInputRef}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                  if (e.key === "Escape") cancelEditName();
                }}
                onBlur={() => void saveName()}
                disabled={savingName}
                maxLength={120}
                placeholder="Nombre de la conversación"
                className="w-full max-w-[260px] truncate bg-transparent text-[13px] font-medium tracking-tight-er text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60 dark:text-neutral-50 dark:placeholder:text-neutral-500"
              />
            ) : (
              <button
                onClick={startEditName}
                disabled={!conversation}
                className="group/title flex max-w-full items-center gap-1.5 text-left text-[13px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50"
                title="Editar nombre"
              >
                <span className="truncate">
                  {conversation?.display_name ?? "…"}
                </span>
                {savingName ? (
                  <Loader2
                    className="h-3 w-3 shrink-0 animate-spin text-neutral-400 dark:text-neutral-500"
                    strokeWidth={1.75}
                  />
                ) : (
                  <Pencil
                    className="h-3 w-3 shrink-0 text-neutral-300 opacity-0 transition group-hover/title:opacity-100 dark:text-neutral-600"
                    strokeWidth={1.75}
                  />
                )}
              </button>
            )}
            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
              {conversation?.source === "whatsapp"
                ? `WhatsApp · +${conversation.external_id ?? "?"}`
                : "Conversación de prueba"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              onOpenComments({
                type: "conversation",
                id: conversationId,
                label: conversation?.display_name ?? "conversación",
              })
            }
            className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
            title="Comentarios de la conversación"
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Mensajes */}
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-6 sm:px-8">
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> Cargando…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
              Sin mensajes todavía
            </p>
            <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-500">
              Escribí el primero desde abajo para arrancar la prueba
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              viewMode={viewMode}
              reactions={reactions[m.id]}
              onSubmitReaction={handleSubmitReaction}
            />
          ))
        )}
        {thinking && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-neutral-500 dark:text-neutral-500">
            <span className="flex gap-1">
              <span className="h-1 w-1 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500 [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500 [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500" />
            </span>
            El agente está escribiendo
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <MessageComposer conversationId={conversationId} />
    </div>
  );
}
