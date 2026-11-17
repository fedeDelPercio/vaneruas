"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowDown,
  Check,
  ExternalLink,
  Flag,
  Loader2,
  Mail,
  Menu,
  MessageSquare,
  PanelRight,
  Pencil,
  Phone,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CommentKind, Conversation, Message } from "@/lib/supabase/types";
import type { ViewMode } from "@/lib/profile";
import { ghlConversationUrl } from "@/lib/ghl-link";
import { formatPhone } from "@/lib/search";
import { useProfile } from "../ProfileProvider";
import { Avatar } from "../Avatar";
import { MessageBubble } from "../MessageBubble";
import { EMPTY_REACTION, type MessageReactionState } from "../MessageReactions";
import type { CommentTarget } from "../ConversationPanel";
import { ModeToggle, type ConversationMode } from "./ModeToggle";
import { WaComposer } from "./WaComposer";

// Panel de chat de una conversación REAL de WhatsApp, visto desde el equipo:
// la clienta a la izquierda, lo nuestro (Valentina o una persona) a la derecha.
// Desde acá se toma la conversación, se le escribe a la clienta y se marca
// atendida una derivación.

const PAGE = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Si quien mira está a menos de esto del final, un mensaje nuevo lo lleva abajo.
const NEAR_BOTTOM_PX = 160;

const CATEGORY_LABELS: Record<string, string> = {
  fuera_de_conocimiento: "Fuera de conocimiento",
  escalado_manual: "Escalado manual",
  reclamo_certificado: "Reclamo de certificado",
  cliente_existente: "Cliente existente",
  interes_compra: "Interés de compra",
  falla_tecnica: "Falla técnica",
};

interface PendingNotification {
  id: string;
  category: string;
  summary: string | null;
  created_at: string;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  const label = d.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function WaChatPanel({
  conversationId,
  onOpenSidebar,
  onOpenComments,
  onRenamed,
  onModeChanged,
  fichaOpen,
  onToggleFicha,
}: {
  conversationId: string;
  onOpenSidebar: () => void;
  onOpenComments: (target: CommentTarget) => void;
  onRenamed?: (id: string, name: string) => void;
  onModeChanged?: (id: string, mode: ConversationMode) => void;
  fichaOpen: boolean;
  onToggleFicha: () => void;
}) {
  const { profile } = useProfile();
  const viewMode: ViewMode = profile?.role === "dev" ? "advanced" : "simple";

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [pending, setPending] = useState<PendingNotification[]>([]);
  const [resolving, setResolving] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // El modo quedó guardado acá pero la etiqueta de GHL no: se ofrece reintentar.
  const [tagSyncFailed, setTagSyncFailed] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [reactions, setReactions] = useState<Record<string, MessageReactionState>>({});
  const [unseen, setUnseen] = useState(0);
  const [rtNonce, setRtNonce] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Qué hacer con el scroll después del próximo render de mensajes.
  const scrollIntent = useRef<"bottom" | "bottom-smooth" | "keep" | null>(null);
  const keepFrom = useRef<{ height: number; top: number } | null>(null);
  // ¿Quien mira está al final? Mientras lo esté, el chat se queda pegado
  // abajo aunque el contenido crezca (imágenes que terminan de cargar,
  // mensajes nuevos). Si subió a leer, no se lo mueve.
  const atBottomRef = useRef(true);

  const mode: ConversationMode = conversation?.mode === "HUMAN" ? "HUMAN" : "AI";

  // ---- Nombre editable --------------------------------------------------
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cancelingNameRef = useRef(false);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  async function saveName() {
    if (cancelingNameRef.current) {
      cancelingNameRef.current = false;
      return;
    }
    const trimmed = nameInput.trim();
    if (!conversation || !trimmed || trimmed === conversation.display_name) {
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
      onRenamed?.(conversationId, trimmed);
      setEditingName(false);
    } catch {
      toast.error("Error de red al renombrar");
    } finally {
      setSavingName(false);
    }
  }

  // ---- Datos ------------------------------------------------------------
  const refreshThinking = useCallback(async () => {
    const { count } = await getSupabaseBrowserClient()
      .from("agent_jobs")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .in("status", ["pending", "processing"]);
    setThinking((count ?? 0) > 0);
  }, [conversationId]);

  const refreshPending = useCallback(async () => {
    const { data } = await getSupabaseBrowserClient()
      .from("agent_notifications")
      .select("id, category, summary, created_at")
      .eq("conversation_id", conversationId)
      .is("resolved_at", null)
      // Mismo criterio que la lista y que Derivaciones: comprobantes y reclamos
      // de certificado tienen módulo propio. "Marcar atendida" cierra lo que
      // muestra este cartel, así que no puede incluir un reclamo de certificado
      // (lo sacaría de la cola de Certificados sin que nadie lo haya resuelto).
      .not("category", "in", "(validacion_pago,reclamo_certificado)")
      .order("created_at", { ascending: true });
    setPending(data ?? []);
  }, [conversationId]);

  const refreshReactions = useCallback(
    async (messageIds: string[]) => {
      if (messageIds.length === 0) {
        setReactions({});
        return;
      }
      const map: Record<string, MessageReactionState> = {};
      for (const id of messageIds) map[id] = { ...EMPTY_REACTION };
      // Los ids viajan en la URL: de a 100 para no pasarse de largo.
      for (let i = 0; i < messageIds.length; i += 100) {
        const { data } = await getSupabaseBrowserClient()
          .from("comments")
          .select("target_id, author_id, kind")
          .eq("target_type", "message")
          .in("target_id", messageIds.slice(i, i + 100));
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
      }
      setReactions(map);
    },
    [profile?.id],
  );

  const handleSubmitReaction = useCallback(
    async (messageId: string, kind: CommentKind, content: string | null) => {
      if (!profile) {
        toast.error("Necesitás un perfil para comentar");
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

  /** Suma mensajes sin duplicar y los deja en orden cronológico. */
  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      let changed = false;
      for (const m of incoming) {
        if (!byId.has(m.id)) changed = true;
        byId.set(m.id, m);
      }
      if (!changed) return prev;
      return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    let hadSubscribed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const loadLatest = async (initial: boolean) => {
      const [convRes, msgRes] = await Promise.all([
        supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle(),
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(PAGE),
      ]);
      if (!active) return;
      const latest = (msgRes.data ?? []).slice().reverse();
      if (initial) {
        setConversation(convRes.data);
        setNotFound(!convRes.data);
        setHasEarlier((msgRes.data ?? []).length === PAGE);
        scrollIntent.current = "bottom";
        setMessages(latest);
        setLoading(false);
        void refreshReactions(latest.map((m) => m.id));
      } else {
        if (convRes.data) setConversation(convRes.data);
        mergeMessages(latest);
      }
      void refreshThinking();
      void refreshPending();
    };

    if (!UUID_RE.test(conversationId)) {
      // Link roto: ni se consulta (Postgres rechaza el id y ensucia la consola).
      setNotFound(true);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    if (rtNonce === 0) {
      setLoading(true);
      void loadLatest(true);
    } else {
      void loadLatest(false);
    }

    const channel = supabase
      .channel(`wa-chat-${conversationId}-${rtNonce}`)
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
          if (messagesRef.current.some((m) => m.id === incoming.id)) return;
          if (atBottomRef.current) scrollIntent.current = "bottom-smooth";
          else setUnseen((n) => n + 1);
          mergeMessages([incoming]);
          void refreshThinking();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          // Cambio de modo desde GHL (tag de pausa), nombre o correo capturado.
          setConversation((c) => (c ? { ...c, ...(payload.new as Conversation) } : c));
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
        {
          event: "*",
          schema: "public",
          table: "agent_notifications",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void refreshPending(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => {
        void refreshReactions(messagesRef.current.map((m) => m.id));
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          if (hadSubscribed) void loadLatest(false);
          hadSubscribed = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (retry) clearTimeout(retry);
          retry = setTimeout(() => active && setRtNonce((n) => n + 1), 3000);
        }
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") void loadLatest(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, rtNonce, mergeMessages, refreshThinking, refreshPending, refreshReactions]);

  async function loadEarlier() {
    const oldest = messages[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    const { data } = await getSupabaseBrowserClient()
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      // "menor o igual": dos mensajes pueden compartir la hora exacta, y con
      // "menor" el segundo se salteaba. Los repetidos los descarta el merge.
      .lte("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const el = scrollRef.current;
    if (el) keepFrom.current = { height: el.scrollHeight, top: el.scrollTop };
    scrollIntent.current = "keep";
    setHasEarlier((data ?? []).length === PAGE);
    const earlier = (data ?? []).slice().reverse();
    mergeMessages(earlier);
    void refreshReactions([...earlier.map((m) => m.id), ...messages.map((m) => m.id)]);
    setLoadingEarlier(false);
  }

  // Scroll después de pintar: al final al abrir, suave con un mensaje nuevo, o
  // quieto (compensando la altura) al cargar mensajes anteriores.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const intent = scrollIntent.current;
    if (!el || !intent) return;
    scrollIntent.current = null;
    if (intent === "keep" && keepFrom.current) {
      el.scrollTop = el.scrollHeight - keepFrom.current.height + keepFrom.current.top;
      keepFrom.current = null;
    } else if (intent === "bottom-smooth") {
      atBottomRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      atBottomRef.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Las imágenes cargan después y empujan el final: si quien mira estaba
  // abajo, se lo mantiene abajo.
  useEffect(() => {
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el || loading) return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [loading, conversationId]);

  function scrollToBottom() {
    const el = scrollRef.current;
    atBottomRef.current = true;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    if (near && unseen > 0) setUnseen(0);
  }

  // Deep link desde Feedback: ?highlight=<mensaje>.
  const highlightMsgId = useSearchParams().get("highlight");
  const highlightedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightMsgId || loading || highlightedRef.current === highlightMsgId) return;
    if (!messages.some((m) => m.id === highlightMsgId)) return;
    highlightedRef.current = highlightMsgId;
    const t = setTimeout(() => {
      const el = document.getElementById(`message-${highlightMsgId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("highlight-message");
      setTimeout(() => el.classList.remove("highlight-message"), 1600);
    }, 150);
    return () => clearTimeout(t);
  }, [highlightMsgId, loading, messages]);

  // ---- Acciones ---------------------------------------------------------
  async function changeMode(next: ConversationMode, retry = false) {
    // `retry`: mismo modo, solo para volver a intentar la etiqueta en GHL.
    if (modeBusy || (next === mode && !retry)) return;
    setModeBusy(true);
    try {
      const r = await fetch(`/api/wa/mode/${conversationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; ghlSynced?: boolean | null };
      if (!r.ok) {
        toast.error(j.error ?? "No se pudo cambiar quién atiende");
        return;
      }
      setConversation((c) => (c ? { ...c, mode: next } : c));
      onModeChanged?.(conversationId, next);
      setTagSyncFailed(j.ghlSynced === false);
      if (retry && j.ghlSynced !== false) {
        toast.success("Listo, quedó marcado en GoHighLevel");
      } else if (j.ghlSynced === false) {
        // El modo quedó guardado acá pero no la etiqueta en GHL: decir qué
        // implica, porque los dos lados quedaron distintos.
        toast.error(
          next === "HUMAN"
            ? "Tomaste la conversación, pero no se pudo marcar en GoHighLevel. Si alguien reactiva la IA para todos, Valentina vuelve a responder acá. Probá de nuevo en un rato"
            : "Valentina vuelve a responder, pero en GoHighLevel la conversación sigue marcada como humano. Probá de nuevo en un rato",
          { duration: 9000 },
        );
      } else {
        toast.success(
          next === "HUMAN"
            ? "Tomaste la conversación. Valentina queda en pausa"
            : "Valentina vuelve a responder desde el próximo mensaje de la clienta",
          { duration: 5000 },
        );
      }
    } catch {
      toast.error("Error de red al cambiar quién atiende");
    } finally {
      setModeBusy(false);
    }
  }

  async function resolvePending() {
    if (resolving || pending.length === 0) return;
    setResolving(true);
    try {
      const results = await Promise.all(
        pending.map((n) =>
          fetch(`/api/interventions/${n.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ resolved: true, resolvedBy: profile?.id ?? null }),
          }),
        ),
      );
      if (results.some((r) => !r.ok)) toast.error("No se pudo marcar como atendida");
      await refreshPending();
      window.dispatchEvent(new Event("atp:notifications-changed"));
    } catch {
      toast.error("Error de red");
    } finally {
      setResolving(false);
    }
  }

  // ---- Render -----------------------------------------------------------
  if (notFound) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-white p-6 text-center dark:bg-neutral-950">
        <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
          No encontramos esa conversación
        </p>
        <p className="text-[12px] text-neutral-500">Revisá el link o elegí otra de la lista</p>
        <button
          onClick={onOpenSidebar}
          className="mt-2 rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-neutral-600 md:hidden dark:border-neutral-800 dark:text-neutral-300"
        >
          Ver conversaciones
        </button>
      </div>
    );
  }

  const phone = formatPhone(conversation?.wa_jid ?? null);
  const phoneDigits = (conversation?.wa_jid ?? "").replace(/\D/g, "");
  const ghlUrl = conversation
    ? ghlConversationUrl({
        id: conversation.id,
        source: conversation.source,
        externalId: conversation.external_id,
      })
    : null;
  const lastCustomerMessageAt =
    [...messages].reverse().find((m) => m.role === "user")?.created_at ?? null;
  const headerBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-50";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-neutral-950">
      {/* Cabecera */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-3 sm:px-5 dark:border-neutral-800">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button onClick={onOpenSidebar} className={`${headerBtn} -ml-1 md:hidden`} aria-label="Ver conversaciones">
            <Menu className="h-4 w-4" strokeWidth={1.75} />
          </button>
          {conversation && <Avatar name={conversation.display_name} size="md" />}
          <div className="min-w-0 flex-1">
            {editingName ? (
              <input
                ref={nameInputRef}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                  if (e.key === "Escape") {
                    cancelingNameRef.current = true;
                    setEditingName(false);
                  }
                }}
                onBlur={() => void saveName()}
                disabled={savingName}
                maxLength={120}
                aria-label="Nombre del contacto"
                className="w-full max-w-[260px] rounded-md border border-neutral-200 bg-transparent px-1.5 py-0.5 text-[13px] font-medium tracking-tight-er text-neutral-900 outline-none disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-50"
              />
            ) : (
              <button
                onClick={() => {
                  if (!conversation) return;
                  setNameInput(conversation.display_name);
                  cancelingNameRef.current = false;
                  setEditingName(true);
                }}
                disabled={!conversation}
                title="Editar nombre"
                className="group/title flex max-w-full items-center gap-1.5 text-left text-[14px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50"
              >
                <span className="truncate">{conversation?.display_name ?? "…"}</span>
                {savingName ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-neutral-400" strokeWidth={1.75} />
                ) : (
                  <Pencil
                    className="h-3 w-3 shrink-0 text-neutral-300 opacity-0 transition group-hover/title:opacity-100 dark:text-neutral-600"
                    strokeWidth={1.75}
                  />
                )}
              </button>
            )}
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              {phone &&
                (phoneDigits ? (
                  <a
                    href={`https://wa.me/${phoneDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir en WhatsApp"
                    className="flex items-center gap-1 whitespace-nowrap font-mono text-[11px] transition hover:text-neutral-900 dark:hover:text-neutral-50"
                  >
                    <Phone className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    {phone}
                  </a>
                ) : (
                  <span className="font-mono">{phone}</span>
                ))}
              {conversation?.contact_email && (
                <span className="hidden min-w-0 items-center gap-1 lg:flex">
                  <Mail className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{conversation.contact_email}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {conversation && <ModeToggle mode={mode} onChange={(m) => void changeMode(m)} busy={modeBusy} />}
          {ghlUrl && (
            <a
              href={ghlUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir el contacto en GoHighLevel"
              aria-label="Abrir el contacto en GoHighLevel"
              className={`${headerBtn} hidden sm:flex`}
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
            </a>
          )}
          <button
            onClick={() =>
              onOpenComments({
                type: "conversation",
                id: conversationId,
                label: conversation?.display_name ?? "conversación",
              })
            }
            title="Notas internas de la conversación"
            aria-label="Notas internas de la conversación"
            className={headerBtn}
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            onClick={onToggleFicha}
            aria-pressed={fichaOpen}
            title={fichaOpen ? "Ocultar ficha del contacto" : "Ver ficha del contacto"}
            aria-label="Ficha del contacto"
            className={`${headerBtn} ${fichaOpen ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50" : ""}`}
          >
            <PanelRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Derivación sin atender */}
      {pending.length > 0 && (
        <div className="flex items-start gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 sm:px-6 dark:border-neutral-800 dark:bg-neutral-900/40">
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">
              {pending.length === 1
                ? `Derivada al equipo · ${CATEGORY_LABELS[pending[0]!.category] ?? pending[0]!.category}`
                : `${pending.length} derivaciones al equipo sin atender`}
            </p>
            {pending[pending.length - 1]!.summary && (
              <button
                type="button"
                onClick={() => setSummaryOpen((v) => !v)}
                aria-expanded={summaryOpen}
                title={summaryOpen ? "Mostrar menos" : "Leer completo"}
                className={`mt-0.5 w-full break-words text-left text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400 ${
                  summaryOpen ? "block whitespace-pre-wrap" : "line-clamp-2"
                }`}
              >
                {pending[pending.length - 1]!.summary}
              </button>
            )}
          </div>
          <button
            onClick={() => void resolvePending()}
            disabled={resolving}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:text-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-600"
          >
            {resolving ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Check className="h-3 w-3" strokeWidth={2} />
            )}
            Marcar atendida
          </button>
        </div>
      )}

      {/* Mensajes */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="scroll-thin h-full overflow-y-auto px-3 py-5 sm:px-6"
        >
          <div ref={contentRef} className="min-h-full space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> Cargando mensajes…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                Sin mensajes todavía
              </p>
              <p className="mt-1 text-[12px] text-neutral-500">
                Cuando la clienta escriba, lo vas a ver acá
              </p>
            </div>
          ) : (
            <>
              {hasEarlier && (
                <div className="flex justify-center pb-2">
                  <button
                    onClick={() => void loadEarlier()}
                    disabled={loadingEarlier}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  >
                    {loadingEarlier && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />}
                    Ver mensajes anteriores
                  </button>
                </div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                return (
                  <div key={m.id}>
                    {newDay && (
                      <div className="flex justify-center py-3">
                        <span className="rounded-full bg-neutral-100 px-3 py-1 text-[10.5px] font-medium text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                          {dayLabel(m.created_at)}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      message={m}
                      viewMode={viewMode}
                      perspective="team"
                      showAuthor={newDay || !prev || prev.role !== m.role}
                      reactions={reactions[m.id]}
                      onSubmitReaction={handleSubmitReaction}
                    />
                  </div>
                );
              })}
              {thinking && mode === "AI" && (
                <div className="flex items-center justify-end gap-2 px-2 pt-1 text-[12px] text-neutral-500">
                  Valentina está escribiendo
                  <span className="flex gap-1">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:-0.4s]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:-0.2s]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400" />
                  </span>
                </div>
              )}
            </>
          )}
          </div>
        </div>

        {unseen > 0 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-800 shadow-soft transition hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-soft-dark"
          >
            <ArrowDown className="h-3 w-3" strokeWidth={2} />
            {unseen === 1 ? "1 mensaje nuevo" : `${unseen} mensajes nuevos`}
          </button>
        )}
      </div>

      {tagSyncFailed && (
        <div className="flex items-center gap-3 border-t border-neutral-200 bg-neutral-50 px-4 py-2 sm:px-8 dark:border-neutral-800 dark:bg-neutral-900/40">
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-warn-fg dark:text-warn">
            {mode === "HUMAN"
              ? "Falta marcar esta conversación en GoHighLevel. Hasta entonces, reactivar la IA para todos se la devuelve a Valentina"
              : "En GoHighLevel esta conversación sigue marcada como humano"}
          </p>
          <button
            onClick={() => void changeMode(mode, true)}
            disabled={modeBusy}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 transition hover:border-neutral-300 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {modeBusy && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
            Reintentar
          </button>
        </div>
      )}

      {conversation && (
        <WaComposer
          conversationId={conversationId}
          mode={mode}
          modeBusy={modeBusy}
          onTake={() => void changeMode("HUMAN")}
          onRelease={() => void changeMode("AI")}
          lastCustomerMessageAt={lastCustomerMessageAt}
          onSent={(message, ghlSynced) => {
            if (!ghlSynced) setTagSyncFailed(true);
            if (message) {
              scrollIntent.current = "bottom-smooth";
              mergeMessages([message]);
            } else {
              toast.success("Mensaje enviado. Va a aparecer en el chat en unos minutos", {
                duration: 7000,
              });
            }
          }}
        />
      )}
    </div>
  );
}
