"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Loader2,
  Receipt,
  Check,
  X,
  RotateCcw,
  AlertTriangle,
  GraduationCap,
  ShieldAlert,
  MessageSquareQuote,
  Users,
  KeyRound,
  SearchX,
} from "lucide-react";
import { TiendupAutoEnrollToggle } from "@/components/TiendupAutoEnrollToggle";
import { useProfile } from "./ProfileProvider";
import { DISMISS_NOTE } from "@/lib/payments/dismiss";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ContactStrip } from "./ContactStrip";
import { ConversationLinks } from "./ConversationLinks";
import { SearchField } from "./SearchField";
import { FilterChip, FilterChips, FilterPanel } from "./ui/FilterChips";
import { useContactSearch } from "./useContactSearch";
import { eventBySlug } from "@/lib/payments/event-match";
import { needsCourseAccess } from "@/lib/payments/revision-card";
import { clientEnv } from "@/lib/env";
import { PaymentCard } from "./payments/PaymentCard";
import { InterventionChip } from "./payments/TitleLine";
import { fmtDateTime, Thumb } from "./payments/receipt-fields";
import { ResizableChatPane } from "./ResizableChatPane";
import { CommentsPanel } from "./CommentsPanel";
import type { CommentTarget } from "./ConversationPanel";
import { ContactPanel } from "./wa/ContactPanel";
import { WaChatPanel } from "./wa/WaChatPanel";
import type {
  PaymentItem,
  PaymentStats,
  TitleReview,
  TitleSubmission,
} from "@/app/api/payments/route";

// Sección de validación de comprobantes de pago. Lista todos los comprobantes
// capturados por el agente (datos leídos con vision), ordenados por fecha. El
// equipo revisa cada uno contra su contabilidad y lo marca aprobado o
// rechazado para habilitar (o no) el acceso al curso.

type StatusFilter = "pending" | "validated" | "rejected" | "all" | "sin-acceso";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Pendientes" },
  { key: "validated", label: "Validados" },
  { key: "rejected", label: "Rechazados" },
  { key: "all", label: "Todos" },
  // Masterclasses validadas con acceso pendiente, incluso sin correo.
  { key: "sin-acceso", label: "Falta acceso" },
];

type EventFilter = "all" | "congreso" | "masterclass";

/** Contactos (tarjetas) que se pintan por tanda. */
const GROUPS_PER_PAGE = 100;

/** A qué evento corresponde un comprobante (por su slug), o null si no se identificó. */
function eventKind(slug: string | null | undefined): "congreso" | "masterclass" | null {
  const ev = eventBySlug(slug);
  if (!ev) return null;
  return ev.slug === "congreso" ? "congreso" : "masterclass";
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const min = Math.round(ms / 60000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) return remMin ? `${hours} h ${remMin} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days} d ${remHours} h` : `${days} d`;
}

/**
 * Agrupa comprobantes por conversación: una sola card por contacto, aunque haya
 * mandado varios comprobantes (cada uno conserva su propia aprobación/rechazo).
 * Mantiene el orden de aparición. Los que no tienen conversación van en su
 * propia card.
 */
function groupByConversation(items: PaymentItem[]): PaymentItem[][] {
  const groups: PaymentItem[][] = [];
  const byConv = new Map<string, PaymentItem[]>();
  for (const it of items) {
    const key = it.conversation?.id;
    if (!key) {
      groups.push([it]);
      continue;
    }
    const existing = byConv.get(key);
    if (existing) {
      existing.push(it);
    } else {
      const arr = [it];
      byConv.set(key, arr);
      groups.push(arr);
    }
  }
  return groups;
}

/**
 * Cruz para descartar una card que no correspondía (una captura de pantalla que
 * se coló, una imagen que no era comprobante ni título). El filtro automático
 * saca la mayoría, pero siempre puede pasar alguna: esto la saca de la cola sin
 * borrar nada, queda registrada como descartada.
 *
 * Pide confirmación en el lugar: un clic al lado del badge de estado es muy
 * fácil de errar.
 */
function DismissButton({
  busy,
  confirming,
  onAskConfirm,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  confirming: boolean;
  onAskConfirm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <span className="text-[11.5px] tracking-tight-er text-neutral-500 dark:text-neutral-400">
          Descartar?
        </span>
        <button
          onClick={onConfirm}
          disabled={busy}
          title="Sacarlo de la cola: no era un comprobante ni un título"
          className="rounded-md px-2 py-1 text-[12px] font-medium text-red-700 transition hover:bg-red-600/[0.08] disabled:opacity-40 dark:text-red-300"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : "Sí"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-2 py-1 text-[12px] text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          No
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={onAskConfirm}
      disabled={busy}
      title="Descartar: esta imagen no correspondía"
      aria-label="Descartar"
      className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-40 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
    >
      <X className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

/** Veredicto de un título: válido / a revisar / revisado por el equipo. */
function VerdictPill({ sub }: { sub: TitleSubmission }) {
  if (sub.isValid) {
    return (
      <span className="inline-flex items-center gap-1 badge-pill border-ok/30 bg-ok/[0.06] text-ok">
        <Check className="h-3 w-3" strokeWidth={2} />
        Título válido
      </span>
    );
  }
  if (sub.reviewedAt) {
    return (
      <span className="inline-flex items-center badge-pill border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
        Revisado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 badge-pill border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
      <ShieldAlert className="h-3 w-3 text-warn" strokeWidth={1.75} />
      Sin validar por IA
    </span>
  );
}

/** Una fila de título con sus datos leídos y las acciones de revisión. */
function TitleSubmissionRow({
  sub,
  busy,
  onApprove,
  onReject,
}: {
  sub: TitleSubmission;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const pending = !sub.isValid && !sub.reviewedAt;
  return (
    <div className="flex gap-3">
      <div className="shrink-0">
        <Thumb url={sub.url} type={sub.fileType} alt="Título profesional" className="h-20 w-14" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            {sub.titleName ?? "Título sin nombre leído"}
          </p>
          <VerdictPill sub={sub} />
        </div>
        <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
          {sub.holderName ?? "Titular no leída"}
          {sub.institution ? ` · ${sub.institution}` : ""}
        </p>
        {sub.validationNote && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500 dark:text-neutral-500">
            {sub.validationNote}
          </p>
        )}
        {pending && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={onReject}
              disabled={busy}
              className="rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Rechazar
            </button>
            <button
              onClick={onApprove}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-gold to-gold-start px-3 py-1.5 text-[12px] font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              ) : (
                <GraduationCap className="h-3 w-3" strokeWidth={2} />
              )}
              Validar título
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Último mensaje de la contacta (contexto: ej. una negativa a mandar el título). */
function ContactNote({
  text,
  label,
  className = "mt-3",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && (
        <p className="mb-1 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          {label}
        </p>
      )}
      <div className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
        <MessageSquareQuote
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500"
          strokeWidth={1.75}
        />
        <p className="text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-300">
          {text}
        </p>
      </div>
    </div>
  );
}

export function PaymentsList() {
  const { profile } = useProfile();
  // Buscador. Con 2 letras o más se busca en TODOS los estados: quien busca a
  // una persona no sabe (ni le importa) si su comprobante está pendiente,
  // validado o rechazado. La búsqueda la resuelve el servidor (?q=).
  const { query, setQuery, activeQuery } = useContactSearch(300);
  const searching = activeQuery.length >= 2;
  const searchQuery = searching ? activeQuery : "";
  // ?filter= abre una pestaña puntual (ej. /revision linkea a "Falta acceso").
  const urlFilter = useSearchParams().get("filter");
  const [filter, setFilter] = useState<StatusFilter>(
    FILTERS.some((f) => f.key === urlFilter) ? (urlFilter as StatusFilter) : "pending",
  );
  const [groupLimit, setGroupLimit] = useState(GROUPS_PER_PAGE);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [interventions, setInterventions] = useState<Record<string, number>>({});
  const [interventionCategories, setInterventionCategories] = useState<Record<string, string>>({});
  const [items, setItems] = useState<PaymentItem[] | null>(null);
  const [titleReviews, setTitleReviews] = useState<TitleReview[]>([]);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAccess, setBusyAccess] = useState<Record<string, "grant" | "mark">>({});
  const [accessResults, setAccessResults] = useState<Record<string, { text: string; error?: boolean }>>({});
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatView, setChatView] = useState<"chat" | "ficha">("chat");
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  function openChat(id: string | null) {
    setChatId(id);
    setChatView("chat");
    setCommentTarget(null);
  }
  const closeChat = () => openChat(null);
  // Confirmación de "Ya tiene acceso" (marcar como resuelto sin inscribir en
  // Tiendup): para casos que el equipo ya dio de alta por afuera.
  const [confirmMarkId, setConfirmMarkId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyTitleId, setBusyTitleId] = useState<string | null>(null);
  const [confirmForceId, setConfirmForceId] = useState<string | null>(null);
  // Card cuya cruz de "descartar" está pidiendo confirmación (id del pago o de
  // la primera imagen de la card de título).
  const [confirmDismiss, setConfirmDismiss] = useState<string | null>(null);
  // Rechazar es destructivo y silencioso: la tarjeta desaparece de Pendientes.
  // Sin confirmación, dos clicks seguidos en la misma posición (la lista se
  // reordena después de cada acción) rechazan comprobantes buenos. Pasó el
  // 20/10 con dos pagos de $110.000, con 2 segundos de diferencia.
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const searchRef = useRef(searchQuery);
  searchRef.current = searchQuery;
  // Descarta respuestas viejas (cambio de pestaña o de búsqueda en el medio).
  const requestRef = useRef(0);

  const load = useCallback(async (status: StatusFilter, q: string) => {
    const requestId = ++requestRef.current;
    try {
      // "Falta acceso" es una vista sobre los validados (el resto se filtra acá).
      const apiStatus = status === "sin-acceso" ? "validated" : status;
      const params = new URLSearchParams(q ? { q } : { status: apiStatus });
      params.set("with", "access");
      params.append("with", "interventions");
      const r = await fetch(`/api/payments?${params}`, { cache: "no-store" });
      const j = await r.json();
      if (requestId !== requestRef.current) return;
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar los comprobantes");
        return;
      }
      setError(null);
      setConfirmReject(null);
      setItems(j.items as PaymentItem[]);
      setInterventions(j.interventions ?? {});
      setInterventionCategories(j.interventionCategories ?? {});
      setTitleReviews((j.titleReviews as TitleReview[]) ?? []);
      setStats((j.stats as PaymentStats) ?? null);
    } catch {
      if (requestId === requestRef.current) setError("Error de red");
    }
  }, []);

  useEffect(() => {
    setItems(null);
    setGroupLimit(GROUPS_PER_PAGE);
    void load(filter, searchQuery);
  }, [filter, searchQuery, load]);

  // Realtime: refrescar comprobantes, títulos y derivaciones de la lista.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("payment-validations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_validations" },
        () => void load(filterRef.current, searchRef.current),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "professional_titles" },
        () => void load(filterRef.current, searchRef.current),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_notifications", filter: `client_slug=eq.${clientEnv.NEXT_PUBLIC_CLIENT_SLUG}` },
        () => void load(filterRef.current, searchRef.current),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function setStatus(
    id: string,
    status: "validated" | "rejected" | "pending",
    opts: { force?: boolean } = {},
  ) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/payments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          note: notes[id]?.trim() || null,
          validatedBy: profile?.id ?? null,
          ...(opts.force ? { force: true } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "No se pudo actualizar el comprobante");
        return;
      }
      // Si al aprobar no se pudo avisar al cliente (ventana de 24h vencida u
      // otro error), avisamos en el momento: el comprobante queda marcado para
      // enviar la confirmación a mano.
      if (j.deliveryFailed) {
        setNotice(
          "El pago se aprobó, pero no se pudo avisar al cliente por WhatsApp (probable ventana de 24 horas vencida). Quedó marcado en el comprobante para que le envíes la confirmación manualmente desde GHL.",
        );
      }
      await load(filterRef.current, searchRef.current);
    } catch {
      setError("Error de red al actualizar");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Da acceso al curso (Tiendup) para un pago de masterclass validado. Manual y
   * directo, sin confirmación previa: el server inscribe aunque el correo no
   * figure como cliente (Tiendup lo crea) o la persona figure con otro correo.
   * Si queda dado, el server le avisa a la persona por WhatsApp.
   */
  async function updateAccess(id: string, markOnly = false) {
    setBusyAccess((current) => ({ ...current, [id]: markOnly ? "mark" : "grant" }));
    setAccessResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    const report = (text: string, error = false) =>
      setAccessResults((current) => ({ ...current, [id]: { text, error } }));
    try {
      const r = await fetch(`/api/payments/${id}/grant-access`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(markOnly ? { markOnly: true } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 202 && j.queued) {
        report(j.message ?? "El alta quedó en cola de reintento");
      } else if (!r.ok || !j.ok) {
        report(j.error ?? "No se pudo registrar el acceso al curso", true);
        return;
      } else {
        const message = markOnly
          ? "Alta manual registrada"
          : j.alreadyEnrolled
            ? "Ya estaba inscripta en el curso. El acceso quedó registrado"
            : "Acceso al curso dado";
        report(message);
        // Al resolverse, la tarjeta sale de la cola. El aviso sigue a la vista.
        if (filterRef.current === "pending" || filterRef.current === "sin-acceso") setNotice(message);
      }
      await load(filterRef.current, searchRef.current);
    } catch {
      report("Error de red al registrar el acceso al curso", true);
    } finally {
      if (markOnly) setConfirmMarkId((current) => current === id ? null : current);
      setBusyAccess((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  async function setTitleStatus(titleId: string, action: "approve" | "reject") {
    setBusyTitleId(titleId);
    try {
      const r = await fetch(`/api/titles/${titleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reviewedBy: profile?.id ?? null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? "No se pudo actualizar el título");
        return;
      }
      await load(filterRef.current, searchRef.current);
    } catch {
      setError("Error de red al actualizar el título");
    } finally {
      setBusyTitleId(null);
    }
  }

  /** Descarta un comprobante que no correspondía (queda como rechazado). */
  async function dismissPayment(id: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/payments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "rejected",
          note: DISMISS_NOTE,
          validatedBy: profile?.id ?? null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? "No se pudo descartar el comprobante");
        return;
      }
      setConfirmDismiss(null);
      await load(filterRef.current, searchRef.current);
    } catch {
      setError("Error de red al descartar");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Descarta una card de título a revisar. Una card agrupa todas las imágenes
   * de la misma conversación, así que las marca revisadas a todas: si no,
   * la card volvería a aparecer con las que quedaron sueltas.
   */
  async function dismissTitleReview(tr: TitleReview) {
    const ids = tr.submissions.map((s) => s.id);
    if (!ids.length) return;
    setBusyTitleId(ids[0]!);
    try {
      for (const titleId of ids) {
        const r = await fetch(`/api/titles/${titleId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "reject",
            note: DISMISS_NOTE,
            reviewedBy: profile?.id ?? null,
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j.error ?? "No se pudo descartar");
          return;
        }
      }
      setConfirmDismiss(null);
      await load(filterRef.current, searchRef.current);
    } catch {
      setError("Error de red al descartar");
    } finally {
      setBusyTitleId(null);
    }
  }

  if (error && items === null) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-500">
        {error}
      </div>
    );
  }

  // Contador y filtro por evento. Los conteos se calculan sobre los items del
  // estado actual (pendientes / validados / etc.); el filtro por evento se
  // aplica solo a lo que se muestra. Las revisiones de título sueltas no tienen
  // evento, así que solo aparecen en "Todos".
  // Pendientes viene del servidor con las mismas altas que Falta acceso.
  // La búsqueda abarca todos los estados y conserva sus resultados.
  const countBase = !searching && filter === "sin-acceso"
    ? (items ?? []).filter((p) => needsCourseAccess(p.eventSlug, p.status, p.courseAccessGrantedAt))
    : (items ?? []);
  const congresoCount = countBase.filter((p) => eventKind(p.eventSlug) === "congreso").length;
  const masterclassCount = countBase.filter((p) => eventKind(p.eventSlug) === "masterclass").length;
  const hasEvents = congresoCount > 0 || masterclassCount > 0;
  const visibleItems = countBase.filter(
    (p) => eventFilter === "all" || eventKind(p.eventSlug) === eventFilter,
  );
  const visibleTitleReviews =
    searching || (eventFilter === "all" && filter !== "sin-acceso") ? titleReviews : [];

  // Se pintan de a tandas: "Todos" tiene más de mil tarjetas y dibujarlas de
  // una dejaba la pantalla congelada varios segundos al entrar y al salir.
  const groups = groupByConversation(visibleItems);
  const shownGroups = groups.slice(0, groupLimit);

  const EVENT_FILTERS: { key: EventFilter; label: string; count: number; dot: string }[] = [
    // "Todos" cuenta también los comprobantes sin evento identificado, así
    // coincide con el contador de arriba.
    { key: "all", label: "Todos", count: countBase.length, dot: "" },
    { key: "congreso", label: "Congreso", count: congresoCount, dot: "bg-gold" },
    { key: "masterclass", label: "Masterclass", count: masterclassCount, dot: "bg-ok" },
  ];

  return (
    <ResizableChatPane onClose={closeChat} chat={chatId && (
      <>
        <div className={commentTarget || chatView === "ficha" ? "hidden" : "h-full"}>
          <WaChatPanel key={chatId} conversationId={chatId} onOpenSidebar={closeChat}
            onOpenComments={setCommentTarget} fichaOpen={chatView === "ficha"} onToggleFicha={() => setChatView("ficha")} />
        </div>
        {commentTarget && <CommentsPanel embedded target={commentTarget} onClose={() => setCommentTarget(null)} />}
        {chatView === "ficha" && (
          <ContactPanel key={chatId} embedded conversationId={chatId} onClose={() => {
            setChatView("chat");
            void load(filterRef.current, searchRef.current);
          }} />
        )}
      </>
    )}>
    <div className="scroll-thin h-full overflow-y-auto">
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between pb-3">
        <h1 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          Aprobaciones
        </h1>
        {items && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {visibleItems.length} comprobante{visibleItems.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error && <p role="alert" className="mb-3 text-[13px] text-red-700 dark:text-red-300">{error}</p>}

      {/* Aviso inmediato de una acción (entrega fallida, acceso al curso, etc). */}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/40">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            strokeWidth={1.75}
          />
          <p className="flex-1 text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
            {notice}
          </p>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            aria-label="Cerrar"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Resumen para las gestoras (no ven Métricas): pendientes + tiempo
          promedio de validación. */}
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-md border border-neutral-200 bg-neutral-50/50 px-3.5 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/40">
            <p className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Pendientes
            </p>
            <p className="mt-0.5 font-mono text-[18px] tracking-tight-er text-neutral-900 dark:text-neutral-50">
              {stats.pending}
            </p>
          </div>
          <div className="rounded-md border border-neutral-200 bg-neutral-50/50 px-3.5 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/40">
            <p className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Tiempo prom. de validación
            </p>
            <p className="mt-0.5 font-mono text-[18px] tracking-tight-er text-neutral-900 dark:text-neutral-50">
              {fmtDuration(stats.avgValidationMs)}
            </p>
          </div>
        </div>
      )}

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Nombre, teléfono o correo"
        className="mb-3"
      />
      {searching && (
        <p className="mb-3 text-[12px] text-neutral-500 dark:text-neutral-500">
          Buscando en todos los estados. Elegí una pestaña para volver a la lista
        </p>
      )}

      {/* Filtros por estado y por evento, en una sola tarjeta. */}
      <FilterPanel className="mb-4">
        <FilterChips label="Filtros por estado" columns={5}>
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              active={filter === f.key && !searching}
              onClick={() => {
                setFilter(f.key);
                if (query) setQuery("");
              }}
              label={f.label}
            />
          ))}
        </FilterChips>
        {/* Por evento (Congreso dorado / Masterclass esmeralda), con contador. */}
        {items && hasEvents && (
          <FilterChips label="Filtros por evento" columns={3}>
            {EVENT_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                active={eventFilter === f.key}
                onClick={() => setEventFilter(f.key)}
                label={f.label}
                leading={f.dot ? <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.dot}`} /> : undefined}
                count={f.count}
              />
            ))}
          </FilterChips>
        )}
      </FilterPanel>

      {/* Interruptor del alta automática en Tiendup (solo en Falta acceso). */}
      {filter === "sin-acceso" && !searching && <TiendupAutoEnrollToggle />}

      {items === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-neutral-500 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          Cargando comprobantes…
        </div>
      ) : visibleItems.length === 0 && visibleTitleReviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          {searching ? (
            <SearchX className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
          ) : (
            <Receipt className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
          )}
          {searching ? (
            <>
              <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                Sin resultados para “{activeQuery}”
              </p>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
                No hay comprobantes de esa persona. Probá con otra parte del nombre o del teléfono.
              </p>
            </>
          ) : filter === "sin-acceso" ? (
            <>
              <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                No hay nadie esperando el acceso al curso
              </p>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
                Acá aparecen las masterclass validadas, con correo, a las que todavía no
                se les dio el acceso.
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                No hay comprobantes{" "}
                {eventFilter !== "all"
                  ? `de ${eventFilter === "congreso" ? "Congreso" : "Masterclass"}`
                  : filter !== "all"
                    ? FILTERS.find((f) => f.key === filter)?.label.toLowerCase()
                    : ""}
              </p>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
                Los comprobantes que manden las profesionales por WhatsApp aparecen acá.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {shownGroups.map((group) => {
            const first = group[0]!;
            // Comprobantes a nombre de personas distintas en la misma conversación:
            // alguien compró una entrada para otra persona. Hay que registrar a esa
            // otra persona aparte (no tenemos su mail para darle el acceso).
            const distinctSenders = Array.from(
              new Set(
                group
                  .map((g) => g.senderName?.trim())
                  .filter((n): n is string => Boolean(n)),
              ),
            );
            const multiplePeople = distinctSenders.length >= 2;
            return (
              <section key={first.conversation?.id ?? first.id} className="w-full max-w-[46rem] space-y-3">
                {/* Si mandó más de un comprobante, lo aclaramos: van todos acá. */}
                {group.length > 1 && (
                  <p className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    {group.length} comprobantes de este contacto
                  </p>
                )}

                {/* Comprobantes a nombre de personas distintas: registrar aparte
                    a la otra persona (no tenemos su mail para el acceso). */}
                {multiplePeople && (
                  <div className="mb-3 flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={1.75} />
                    <p className="text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                      Hay comprobantes a nombre de distintas personas ({distinctSenders.join(", ")}).
                      Si alguna entrada es para otra persona, registrala aparte con su nombre y mail:
                      no tenemos sus datos para darle el acceso.
                    </p>
                  </div>
                )}

                {group.map((p) => {
                  const isPending = p.status === "pending";
                  const busy = busyId === p.id;
                  const accessBusy = busyAccess[p.id];
                  const accessResult = p.courseAccessGrantedAt && accessResults[p.id]?.error ? undefined : accessResults[p.id];
                  const esMasterclassValidada = p.status === "validated" && eventKind(p.eventSlug) === "masterclass";
                  const faltaCorreo = esMasterclassValidada && !p.contactEmail;
                  const pendingTitles = p.titles.filter((sub) => sub.hasFile && !sub.isValid && !sub.reviewedAt);
                  return (
                    <PaymentCard key={p.id} payment={p} onOpenChat={openChat}
                      interventionCategory={p.conversation && interventions[p.conversation.id]
                        ? interventionCategories[p.conversation.id] ?? ""
                        : undefined}
                      onSaved={() => void load(filterRef.current, searchRef.current)}
                      titleActions={pendingTitles.length > 0 && (
                        <div className="mt-2 space-y-3">
                          {pendingTitles.map((sub) => (
                            <TitleSubmissionRow key={sub.id} sub={sub} busy={busyTitleId === sub.id}
                              onApprove={() => void setTitleStatus(sub.id, "approve")}
                              onReject={() => void setTitleStatus(sub.id, "reject")} />
                          ))}
                        </div>
                      )}
                    >
                      {/* Acciones */}
                      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                        {isPending && (
                          <DismissButton busy={busy} confirming={confirmDismiss === p.id}
                            onAskConfirm={() => setConfirmDismiss(p.id)} onCancel={() => setConfirmDismiss(null)}
                            onConfirm={() => void dismissPayment(p.id)} />
                        )}

                        {isPending && !p.awaitingTitle && (
                          <input
                            value={notes[p.id] ?? ""}
                            onChange={(e) =>
                              setNotes((n) => ({ ...n, [p.id]: e.target.value }))
                            }
                            placeholder="Nota (opcional)"
                            className="w-40 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600"
                          />
                        )}
                        {isPending && (
                          <>
                            {confirmReject === p.id ? (
                              <>
                                <span className="text-[12px] text-neutral-600 dark:text-neutral-300">
                                  Rechazar este comprobante?
                                </span>
                                <button
                                  onClick={() => setConfirmReject(null)}
                                  disabled={busy}
                                  className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                >
                                  Cancelar
                                </button>
                                <button
                                  onClick={() => {
                                    setConfirmReject(null);
                                    void setStatus(p.id, "rejected");
                                  }}
                                  disabled={busy}
                                  className="flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                                  ) : (
                                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                                  )}
                                  Confirmar rechazo
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setConfirmReject(p.id)}
                                disabled={busy}
                                className="flex items-center gap-1.5 rounded-md border border-red-600/40 px-3.5 py-2 text-[13px] font-medium text-red-700 transition hover:bg-red-600/[0.06] disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
                              >
                                <X className="h-3.5 w-3.5" strokeWidth={2} />
                                Rechazar
                              </button>
                            )}
                          </>
                        )}
                        {isPending && p.awaitingTitle ? (
                          <>
                            {confirmForceId === p.id ? (
                              <>
                                <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
                                  Forzar y avisar a la contacta?
                                </span>
                                <button
                                  onClick={() => setConfirmForceId(null)}
                                  disabled={busy}
                                  className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                >
                                  Cancelar
                                </button>
                                <button
                                  onClick={() => {
                                    setConfirmForceId(null);
                                    void setStatus(p.id, "validated", { force: true });
                                  }}
                                  disabled={busy}
                                  className="flex items-center gap-1.5 btn-gold"
                                >
                                  {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                                  )}
                                  Confirmar
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setConfirmForceId(p.id)}
                                disabled={busy}
                                title="Aprobar el comprobante igual, sin validar el título profesional"
                                className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3.5 py-2 text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                              >
                                <ShieldAlert className="h-3.5 w-3.5 text-warn" strokeWidth={1.75} />
                                Forzar aprobación
                              </button>
                            )}
                          </>
                        ) : isPending ? (
                          <>
                            <button
                              onClick={() => void setStatus(p.id, "validated")}
                              disabled={busy}
                              className="flex items-center gap-1.5 btn-gold"
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                              ) : (
                                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                              )}
                              Aprobar
                            </button>
                          </>
                        ) : (
                          <>
                            {faltaCorreo && !p.courseAccessGrantedAt && (
                              <span className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-warn">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                                Falta el correo para darle el acceso, hay que pedírselo
                              </span>
                            )}
                            {esMasterclassValidada &&
                              (p.courseAccessGrantedAt ? (
                                <span className="flex items-center gap-1.5 text-[12px] text-ok">
                                  <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  Acceso al curso dado
                                </span>
                              ) : confirmMarkId === p.id ? (
                                <>
                                  <span className="mr-auto flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-300">
                                    Marcar como que ya tiene acceso, sin inscribir en Tiendup?
                                  </span>
                                  <button
                                    onClick={() => setConfirmMarkId(null)}
                                    disabled={Boolean(accessBusy)}
                                    className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    onClick={() => void updateAccess(p.id, true)}
                                    disabled={Boolean(accessBusy)}
                                    className="flex items-center gap-1.5 btn-gold"
                                  >
                                    {accessBusy ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                                    ) : (
                                      <Check className="h-3.5 w-3.5" strokeWidth={2} />
                                    )}
                                    Confirmar
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => void updateAccess(p.id)}
                                    disabled={Boolean(accessBusy) || !p.contactEmail}
                                    title={`Inscribir en el curso de Tiendup con ${p.contactEmail ?? "su correo"}`}
                                    className="btn-gold flex items-center gap-1.5"
                                  >
                                    {accessBusy === "grant" ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                                    ) : (
                                      <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                                    )}
                                    {accessBusy === "grant" ? "Dando acceso…" : "Dar acceso al curso"}
                                  </button>
                                  <button
                                    onClick={() => setConfirmMarkId(p.id)}
                                    disabled={Boolean(accessBusy)}
                                    title="Marcar como que ya tiene acceso (sin inscribir en Tiendup)"
                                    className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                  >
                                    Ya le dimos el alta a mano en Tiendup
                                  </button>
                                </>
                              ))}
                            <button
                              onClick={() => void setStatus(p.id, "pending")}
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
                          </>
                        )}
                      </div>
                      {(accessResult || (!p.courseAccessGrantedAt && p.courseAccessError)) && (
                        <p role="status" className={`text-[12px] ${accessResult && !accessResult.error
                          ? "text-neutral-700 dark:text-neutral-300"
                          : "text-red-700 dark:text-red-300"}`}>
                          {accessResult?.text ?? p.courseAccessError}
                        </p>
                      )}
                    </PaymentCard>
                  );
                })}
              </section>
            );
          })}

          {/* Títulos a validar sin comprobante asociado: la contacta mandó algo
              para acreditarse que la IA no dio por bueno, pero todavía no hay un
              comprobante que lo agrupe. */}
          {groups.length > shownGroups.length && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setGroupLimit((n) => n + GROUPS_PER_PAGE)}
                className="rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Mostrar más · quedan {groups.length - shownGroups.length} contactos
              </button>
            </div>
          )}
          {visibleTitleReviews.length > 0 && (
            <>
              <div className="flex items-center gap-2 pt-2">
                <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  Títulos a validar
                </span>
                <span className="h-px flex-1 bg-neutral-100 dark:bg-neutral-800" />
              </div>
              {visibleTitleReviews.map((tr) => (
                <article
                  key={tr.conversation?.id ?? tr.submissions[0]?.id}
                  className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-2 pb-1">
                    <p className="truncate text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
                      {tr.conversation?.displayName ?? "Contacta sin nombre"}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="flex items-center gap-1 badge-pill border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
                        <GraduationCap className="h-3 w-3 text-warn" strokeWidth={1.75} />
                        Sin comprobante
                      </span>
                      {/* Descartar la card entera: la imagen no era un título. */}
                      <DismissButton
                        busy={busyTitleId === tr.submissions[0]?.id}
                        confirming={confirmDismiss === tr.submissions[0]?.id}
                        onAskConfirm={() => setConfirmDismiss(tr.submissions[0]?.id ?? null)}
                        onCancel={() => setConfirmDismiss(null)}
                        onConfirm={() => void dismissTitleReview(tr)}
                      />
                    </div>
                  </div>
                  {tr.conversation && (interventions[tr.conversation.id] ?? 0) > 0 && (
                    <div className="mb-2">
                      <InterventionChip category={interventionCategories[tr.conversation.id] ?? ""} />
                    </div>
                  )}
                  {/* Cuándo llegó: sin esto no se distingue lo nuevo de lo viejo. */}
                  {tr.createdAt && (
                    <p className="pb-3 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                      Recibido {fmtDateTime(tr.createdAt)}
                    </p>
                  )}

                  {tr.conversation?.phone && (
                    <div className="-mt-1 mb-3">
                      <ContactStrip conversation={tr.conversation} />
                    </div>
                  )}

                  <div className="space-y-3">
                    {tr.submissions.map((sub) => (
                      <TitleSubmissionRow
                        key={sub.id}
                        sub={sub}
                        busy={busyTitleId === sub.id}
                        onApprove={() => void setTitleStatus(sub.id, "approve")}
                        onReject={() => void setTitleStatus(sub.id, "reject")}
                      />
                    ))}
                  </div>

                  {tr.contactNote && (
                    <ContactNote
                      text={tr.contactNote}
                      label="Último mensaje de la contacta"
                    />
                  )}

                  {tr.conversation && (
                    <div className="mt-4 flex items-center border-t border-neutral-100 pt-3 dark:border-neutral-800">
                      <ConversationLinks conversation={tr.conversation} onOpenChat={() => openChat(tr.conversation?.id ?? null)} />
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
        </div>
      )}
    </div>
    </div>
    </ResizableChatPane>
  );
}
