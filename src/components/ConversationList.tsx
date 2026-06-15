"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X, MessagesSquare } from "lucide-react";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { clientEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Conversation } from "@/lib/supabase/types";
import { Avatar } from "./Avatar";
import { NewConversationModal } from "./NewConversationModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

// Lista de conversaciones (de prueba o WhatsApp según `sourceFilter`).
// En desktop es una columna fija; en mobile es un drawer (open / onClose).

type Preview = { content: string; role: string };

export function ConversationList({
  selectedId,
  onSelect,
  onDeleted,
  open,
  onClose,
  sourceFilter,
  hideNewButton = false,
  emptyLabel,
  title,
  renamed,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Se llama tras borrar la conversación (para que el parent limpie su
  // selección si esa era la conversación activa).
  onDeleted?: (id: string) => void;
  open: boolean;
  onClose: () => void;
  /** Si se pasa, filtra por conversations.source (ej 'whatsapp'). */
  sourceFilter?: "test" | "whatsapp";
  /** En las secciones que no crean conversaciones manualmente (WhatsApp). */
  hideNewButton?: boolean;
  /** Texto a mostrar cuando no hay conversaciones. */
  emptyLabel?: string;
  /** Header de la columna. */
  title?: string;
  /** Rename hecho desde el panel: se refleja al instante en la lista. */
  renamed?: { id: string; name: string } | null;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [modalOpen, setModalOpen] = useState(false);
  // Conversación pendiente de confirmar borrado.
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refetch = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const query = supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (sourceFilter) {
      query.eq("source", sourceFilter);
    }
    const { data: convs } = await query;
    const list = convs ?? [];
    setConversations(list);

    if (list.length > 0) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("conversation_id, content, role, created_at")
        .in(
          "conversation_id",
          list.map((c) => c.id),
        )
        .order("created_at", { ascending: false })
        .limit(200);
      const map: Record<string, Preview> = {};
      (msgs ?? []).forEach((m) => {
        if (!map[m.conversation_id]) {
          map[m.conversation_id] = { content: m.content, role: m.role };
        }
      });
      setPreviews(map);
    }
  }, [sourceFilter]);

  // Rename desde el panel: parchea el nombre en la lista al instante, sin
  // depender de que llegue el evento realtime (que además puede tardar).
  useEffect(() => {
    if (!renamed) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === renamed.id ? { ...c, display_name: renamed.name } : c,
      ),
    );
  }, [renamed]);

  useEffect(() => {
    void refetch();
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("conversation-list")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `client_slug=eq.${clientEnv.NEXT_PUBLIC_CLIENT_SLUG}`,
        },
        () => void refetch(),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "conversations",
        },
        () => void refetch(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refetch]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const id = pendingDelete.id;
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "No se pudo borrar la conversación");
        return;
      }
      toast.success("Conversación borrada");
      setPendingDelete(null);
      onDeleted?.(id);
      void refetch();
    } catch {
      toast.error("Error de red");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-neutral-900/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-80 shrink-0 flex-col border-r border-neutral-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 dark:border-neutral-800 dark:bg-neutral-950 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header de la columna */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[13px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
              {title ?? "Conversaciones"}
            </h2>
            <span className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
              {conversations.length.toString().padStart(2, "0")}
            </span>
          </div>
          {!hideNewButton && (
            <button
              onClick={() => setModalOpen(true)}
              title="Nueva conversación de prueba"
              aria-label="Nueva conversación"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {/* Lista */}
        <div className="scroll-thin flex-1 overflow-y-auto px-2.5 pb-3">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-400 dark:border-neutral-800 dark:text-neutral-600">
                <MessagesSquare className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-200">
                {emptyLabel ?? "Sin conversaciones todavía"}
              </p>
              {!hideNewButton && !emptyLabel && (
                <p className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                  Creá la primera con el botón <span className="font-mono">+</span> de arriba a la derecha
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-px">
              {conversations.map((c) => {
                const preview = previews[c.id];
                const selected = selectedId === c.id;
                return (
                  <li key={c.id} className="group relative">
                    <button
                      onClick={() => onSelect(c.id)}
                      className={`flex w-full items-start gap-3 rounded-md py-2.5 pl-3 pr-10 text-left transition ${
                        selected
                          ? "bg-neutral-100 dark:bg-neutral-900"
                          : "hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                      }`}
                    >
                      {selected && (
                        <span
                          aria-hidden
                          className="absolute inset-y-2 left-0 w-px bg-neutral-900 dark:bg-neutral-50"
                        />
                      )}
                      <Avatar name={c.display_name} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                            {c.display_name}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                            {formatDistanceToNow(new Date(c.updated_at), {
                              addSuffix: false,
                              locale: es,
                            })}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[12px] text-neutral-500 dark:text-neutral-500">
                          {preview
                            ? `${preview.role === "user" ? "Cliente · " : preview.role === "assistant" ? "Agente · " : ""}${preview.content}`
                            : "Sin mensajes aún"}
                        </p>
                      </div>
                    </button>
                    {/* Botón de borrar: en el espacio reservado a la derecha
                        (pr-10 del botón de selección). Apagado en idle, full
                        opacity en hover del item o focus propio. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(c);
                      }}
                      title="Borrar conversación"
                      aria-label={`Borrar conversación ${c.display_name}`}
                      className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 opacity-0 transition hover:text-rose-500 focus:opacity-100 group-hover:opacity-100 dark:text-neutral-500 dark:hover:text-rose-400"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {modalOpen && (
          <NewConversationModal
            onClose={() => setModalOpen(false)}
            onCreated={(id) => {
              setModalOpen(false);
              void refetch();
              onSelect(id);
            }}
          />
        )}

        {pendingDelete && (
          <ConfirmDeleteModal
            title="Borrar conversación"
            description={`Vas a borrar “${pendingDelete.display_name}” con todos sus mensajes, traces, reacciones y notas. Esta acción no se puede deshacer.`}
            confirmLabel="Borrar conversación"
            loading={deleting}
            onConfirm={() => void confirmDelete()}
            onCancel={() => (deleting ? undefined : setPendingDelete(null))}
          />
        )}
      </div>
    </>
  );
}
