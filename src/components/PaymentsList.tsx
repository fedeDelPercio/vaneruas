"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Receipt,
  FileText,
  Check,
  CheckCheck,
  X,
  RotateCcw,
  ArrowRight,
  AlertTriangle,
  GraduationCap,
  ShieldAlert,
  MessageSquareQuote,
  Mail,
  Ticket,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useProfile } from "./ProfileProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ghlConversationUrl } from "@/lib/ghl-link";
import { ContactStrip } from "./ContactStrip";
import { eventBySlug } from "@/lib/payments/event-match";
import { recipientMismatches } from "@/lib/payments/recipient";
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

type StatusFilter = "pending" | "validated" | "rejected" | "all";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Pendientes" },
  { key: "validated", label: "Validados" },
  { key: "rejected", label: "Rechazados" },
  { key: "all", label: "Todos" },
];

type EventFilter = "all" | "congreso" | "masterclass";

/** A qué evento corresponde un comprobante (por su slug), o null si no se identificó. */
function eventKind(slug: string | null | undefined): "congreso" | "masterclass" | null {
  const ev = eventBySlug(slug);
  if (!ev) return null;
  return ev.slug === "congreso" ? "congreso" : "masterclass";
}

/**
 * Color del badge de evento, para distinguirlos de un vistazo: Congreso dorado
 * (acento de marca), Masterclass esmeralda. Mismo tinte sutil que los demás
 * badges del panel (borde + bg al 6%).
 */
function eventBadgeClass(slug: string | null | undefined): string {
  return eventKind(slug) === "congreso"
    ? "border-gold/30 bg-gold/[0.06] text-gold"
    : "border-ok/30 bg-ok/[0.06] text-ok";
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Fecha y hora del comprobante NORMALIZADA (DD/MM/AAAA, HH:MM), uniforme entre
 * tarjetas. Usa la fecha ya parseada (`transferred_at`), que se guarda como la
 * hora de pared del comprobante en UTC: por eso formateamos en timeZone UTC, así
 * mostramos la hora original sin desfasar por la zona del navegador. Si el OCR no
 * pudo normalizarla, caemos al texto crudo del comprobante.
 */
function fmtTransferDate(transferredAt: string | null, raw: string | null): string | null {
  if (transferredAt) {
    return new Date(transferredAt).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  }
  return raw;
}

/** Formatea una duración en ms a algo legible y corto (ej. "2 h 15 min"). */
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

function fmtAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "Monto no leído";
  const n = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0 }).format(amount);
  return `${currency ?? "ARS"} ${n}`;
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

function statusBadge(status: PaymentItem["status"]): { label: string; cls: string } {
  if (status === "validated") {
    return {
      label: "Validado",
      cls: "border-ok/30 bg-ok/[0.06] text-ok",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rechazado",
      cls: "border-red-600/30 bg-red-600/[0.06] text-red-700 dark:border-red-500/30 dark:bg-red-500/[0.06] dark:text-red-300",
    };
  }
  return {
    label: "Pendiente",
    cls: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400",
  };
}

/**
 * Fila de dato: label mono + valor, SIEMPRE en la misma posición de la grilla.
 * Si no hay dato muestra un guión muted en vez de desaparecer: así los campos
 * no se reordenan ni faltan entre una card y otra, y validar es siempre igual
 * (el ojo encuentra cada campo en el mismo lugar).
 */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-[13px] ${
          value
            ? "text-neutral-800 dark:text-neutral-100"
            : "text-neutral-300 dark:text-neutral-600"
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

/** Miniatura de un adjunto (imagen o PDF) con link a la versión grande. */
function Thumb({
  url,
  type,
  alt,
  className = "h-40 w-32",
}: {
  url: string | null;
  type: string | null;
  alt: string;
  className?: string;
}) {
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center rounded-md border border-dashed border-neutral-200 text-[11px] text-neutral-400 dark:border-neutral-800 ${className}`}
      >
        Sin imagen
      </div>
    );
  }
  if (type === "application/pdf") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex flex-col items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 text-[11.5px] text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300 dark:hover:bg-neutral-800 ${className}`}
      >
        <FileText className="h-5 w-5" strokeWidth={1.5} />
        Ver PDF
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className={`rounded-md border border-neutral-200 object-cover transition hover:opacity-90 dark:border-neutral-800 ${className}`}
      />
    </a>
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
        <Thumb url={sub.url} type={sub.fileType} alt="Título profesional" className="h-28 w-24" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
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
          <div className="mt-2 flex items-center gap-2">
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
  const router = useRouter();
  const { profile } = useProfile();
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [items, setItems] = useState<PaymentItem[] | null>(null);
  const [titleReviews, setTitleReviews] = useState<TitleReview[]>([]);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyTitleId, setBusyTitleId] = useState<string | null>(null);
  const [confirmForceId, setConfirmForceId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async (status: StatusFilter) => {
    try {
      const r = await fetch(`/api/payments?status=${status}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar los comprobantes");
        return;
      }
      setError(null);
      setItems(j.items as PaymentItem[]);
      setTitleReviews((j.titleReviews as TitleReview[]) ?? []);
      setStats((j.stats as PaymentStats) ?? null);
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    setItems(null);
    void load(filter);
  }, [filter, load]);

  // Realtime: refrescar cuando entra un comprobante o un título, o cambia un estado.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("payment-validations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_validations" },
        () => void load(filterRef.current),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "professional_titles" },
        () => void load(filterRef.current),
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
        setDeliveryNotice(
          "El pago se aprobó, pero no se pudo avisar al cliente por WhatsApp (probable ventana de 24 horas vencida). Quedó marcado en el comprobante para que le envíes la confirmación manualmente desde GHL.",
        );
      }
      await load(filterRef.current);
    } catch {
      setError("Error de red al actualizar");
    } finally {
      setBusyId(null);
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
      await load(filterRef.current);
    } catch {
      setError("Error de red al actualizar el título");
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
  const congresoCount = items?.filter((p) => eventKind(p.eventSlug) === "congreso").length ?? 0;
  const masterclassCount = items?.filter((p) => eventKind(p.eventSlug) === "masterclass").length ?? 0;
  const hasEvents = congresoCount > 0 || masterclassCount > 0;
  const visibleItems = (items ?? []).filter(
    (p) => eventFilter === "all" || eventKind(p.eventSlug) === eventFilter,
  );
  const visibleTitleReviews = eventFilter === "all" ? titleReviews : [];

  const EVENT_FILTERS: { key: EventFilter; label: string; count: number; dot: string }[] = [
    { key: "all", label: "Todos", count: congresoCount + masterclassCount, dot: "" },
    { key: "congreso", label: "Congreso", count: congresoCount, dot: "bg-gold" },
    { key: "masterclass", label: "Masterclass", count: masterclassCount, dot: "bg-ok" },
  ];

  return (
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

      {/* Aviso inmediato si al aprobar no se pudo avisar al cliente. */}
      {deliveryNotice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/40">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            strokeWidth={1.75}
          />
          <p className="flex-1 text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
            {deliveryNotice}
          </p>
          <button
            onClick={() => setDeliveryNotice(null)}
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

      {/* Filtros por estado */}
      <div className="mb-3 flex items-center gap-1">
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

      {/* Filtro + contador por evento (Congreso dorado / Masterclass esmeralda) */}
      {items && hasEvents && (
        <div className="mb-4 flex items-center gap-1.5">
          {EVENT_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setEventFilter(f.key)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition ${
                eventFilter === f.key
                  ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />}
              {f.label}
              <span
                className={`font-mono text-[11px] ${
                  eventFilter === f.key
                    ? "opacity-70"
                    : "text-neutral-400 dark:text-neutral-500"
                }`}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {items === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-neutral-500 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          Cargando comprobantes…
        </div>
      ) : visibleItems.length === 0 && visibleTitleReviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Receipt className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
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
        </div>
      ) : (
        <div className="space-y-3">
          {groupByConversation(visibleItems).map((group) => {
            const first = group[0]!;
            const groupAwaitingTitle = group.some((g) => g.awaitingTitle);
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
              <article
                key={first.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                {/* Acreditación del título: UNA vez por contacto, aunque haya
                    mandado varios comprobantes (todos comparten los mismos
                    títulos). Va arriba; abajo, cada comprobante con su acción. */}
                {(first.titles.length > 0 || (groupAwaitingTitle && first.contactNote)) && (
                  <div className="mb-4 border-b border-neutral-100 pb-4 dark:border-neutral-800">
                    <p className="mb-2.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                      <GraduationCap className="h-3 w-3" strokeWidth={1.75} />
                      Título profesional
                    </p>
                    {first.titles.length > 0 && (
                      <div className="space-y-3">
                        {first.titles.map((sub) => (
                          <TitleSubmissionRow
                            key={sub.id}
                            sub={sub}
                            busy={busyTitleId === sub.id}
                            onApprove={() => void setTitleStatus(sub.id, "approve")}
                            onReject={() => void setTitleStatus(sub.id, "reject")}
                          />
                        ))}
                      </div>
                    )}
                    {groupAwaitingTitle && first.contactNote && (
                      <ContactNote
                        text={first.contactNote}
                        label="Mensaje de la contacta sobre el título"
                        className={first.titles.length > 0 ? "mt-3" : "mt-0"}
                      />
                    )}
                  </div>
                )}

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

                {group.map((p, idx) => {
                  const badge = statusBadge(p.status);
                  const ev = eventBySlug(p.eventSlug);
                  const isPending = p.status === "pending";
                  const busy = busyId === p.id;
                  // ¿El destinatario del comprobante no coincide con la cuenta de Vane?
                  const recipientWarn = recipientMismatches(p.recipientName, p.recipientTaxId);
                  const recipientWarnLabels = recipientWarn.map((w) => (w === "cuit" ? "CUIT" : "nombre"));
                  return (
                    <div
                      key={p.id}
                      className={idx > 0 ? "mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800" : ""}
                    >
                <div className="flex flex-col gap-4 sm:flex-row">
                  {/* Comprobante */}
                  <div className="shrink-0">
                    <Thumb url={p.comprobanteUrl} type={p.comprobanteType} alt="Comprobante" />
                  </div>

                  {/* Datos */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
                          {p.senderName ?? "Emisor no leído"}
                        </p>
                        <p className="mt-0.5 font-mono text-[15px] tracking-tight-er text-neutral-900 dark:text-neutral-50">
                          {fmtAmount(p.amount, p.currency)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {ev && (
                          <span
                            className={`flex items-center gap-1 badge-pill ${eventBadgeClass(p.eventSlug)}`}
                            title={`Identificado por el monto: ${ev.label}`}
                          >
                            <Ticket className="h-3 w-3" strokeWidth={1.75} />
                            {ev.shortLabel}
                          </span>
                        )}
                        {p.awaitingTitle && (
                          <span
                            className="flex items-center gap-1 badge-pill border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400"
                            title="Retenido hasta validar el título profesional de la contacta"
                          >
                            <GraduationCap className="h-3 w-3 text-warn" strokeWidth={1.75} />
                            Esperando título
                          </span>
                        )}
                        {p.isDuplicate && (
                          <span
                            className="flex items-center gap-1 badge-pill border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400"
                            title="Otro comprobante anterior tiene el mismo N° de operación"
                          >
                            <AlertTriangle className="h-3 w-3 text-warn" strokeWidth={1.75} />
                            N° repetido
                          </span>
                        )}
                        {p.contactHasValidatedPayment && (
                          <span
                            className="flex items-center gap-1 badge-pill border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400"
                            title="Este contacto ya tiene un comprobante validado en esta conversación. Este envío es adicional."
                          >
                            <CheckCheck className="h-3 w-3 text-ok" strokeWidth={1.75} />
                            Ya envió comprobante
                          </span>
                        )}
                        {p.deliveryFailed && (
                          <span
                            className="flex items-center gap-1 badge-pill border-red-600/30 bg-red-600/[0.06] text-red-700 dark:border-red-500/30 dark:bg-red-500/[0.06] dark:text-red-300"
                            title={p.deliveryError ?? "No se pudo avisar al cliente por WhatsApp"}
                          >
                            <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                            No se avisó al cliente
                          </span>
                        )}
                        {recipientWarn.length > 0 && (
                          <span
                            className="flex items-center gap-1 badge-pill border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400"
                            title="El destinatario del comprobante no coincide con la cuenta de Vanesa Rúas"
                          >
                            <AlertTriangle className="h-3 w-3 text-warn" strokeWidth={1.75} />
                            Destinatario no coincide
                          </span>
                        )}
                        <span
                          className={`badge-pill ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                    </div>

                    {/* Quién escribe (contacto de WhatsApp): puede no coincidir
                        con el emisor del comprobante. Teléfono tappable a wa.me. */}
                    {p.conversation && <ContactStrip conversation={p.conversation} />}

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                      <Field label="Fecha y hora" value={fmtTransferDate(p.transferredAt, p.transferDateRaw)} />
                      <Field label="Banco / medio" value={p.bankOrMethod} />
                      <Field label="N° de operación" value={p.operationNumber} />
                      <Field label="CUIT emisor" value={p.senderTaxId} />
                      <Field label="Destinatario" value={p.recipientName} />
                      <Field label="CUIT destinatario" value={p.recipientTaxId} />
                      <Field label="Concepto" value={p.concept} />
                    </dl>

                    {/* Meta de la lectura + origen */}
                    <p className="mt-3 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                      Recibido {fmtDateTime(p.createdAt)}
                      {p.extractionConfidence ? ` · lectura ${p.extractionConfidence}` : ""}
                    </p>

                    {/* Correo de la contacta (para el acceso / alta en Tiendup) */}
                    {p.contactEmail && (
                      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-300">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                        {p.contactEmail}
                      </p>
                    )}

                    {/* Estado resuelto */}
                    {!isPending && (
                      <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                        {badge.label} por {p.validatedByName ?? "el equipo"}
                        {p.validatedAt ? ` · ${fmtDateTime(p.validatedAt)}` : ""}
                        {p.validationNote ? ` · ${p.validationNote}` : ""}
                      </p>
                    )}

                    {/* Destinatario distinto a la cuenta de Vane: revisar antes
                        de aprobar (puede ser otra cuenta o un comprobante falso). */}
                    {recipientWarn.length > 0 && (
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
                        <AlertTriangle
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn"
                          strokeWidth={1.75}
                        />
                        <p className="text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                          El {recipientWarnLabels.join(" y el ")} del destinatario{" "}
                          {recipientWarn.length > 1 ? "no coinciden" : "no coincide"} con la
                          cuenta de Vanesa Rúas. Verificá el comprobante antes de aprobar.
                        </p>
                      </div>
                    )}

                    {/* No se pudo avisar al cliente (ej. ventana de 24h de
                        WhatsApp vencida): el equipo lo envía a mano. */}
                    {p.deliveryFailed && (
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
                        <AlertTriangle
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400"
                          strokeWidth={1.75}
                        />
                        <p className="text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                          No se pudo avisar al cliente por WhatsApp, probablemente por la
                          ventana de 24 horas vencida. Enviale la confirmación manualmente
                          desde GHL.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Acciones */}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                  {p.conversation && (
                    <button
                      onClick={() => {
                        const url = ghlConversationUrl(p.conversation);
                        if (url) window.open(url, "_blank", "noopener,noreferrer");
                        else router.push(`/conversations?id=${p.conversation!.id}`);
                      }}
                      className="mr-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      Ver conversación
                      <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  )}

                  {isPending && p.awaitingTitle ? (
                    <>
                      <span className="mr-auto flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400 sm:mr-0">
                        <GraduationCap className="h-3.5 w-3.5 text-warn" strokeWidth={1.75} />
                        Validá el título para habilitar, o forzá la aprobación
                      </span>
                      <button
                        onClick={() => void setStatus(p.id, "rejected")}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        ) : (
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        )}
                        Rechazar
                      </button>
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
                      {p.contactHasValidatedPayment && (
                        <span className="mr-auto flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                          <CheckCheck className="h-3.5 w-3.5 text-ok" strokeWidth={1.75} />
                          Este contacto ya tiene un comprobante validado
                        </span>
                      )}
                      <input
                        value={notes[p.id] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [p.id]: e.target.value }))
                        }
                        placeholder="Nota (opcional)"
                        className="w-40 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600"
                      />
                      <button
                        onClick={() => void setStatus(p.id, "rejected")}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        ) : (
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        )}
                        Rechazar
                      </button>
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
                  )}
                </div>
                    </div>
                  );
                })}
              </article>
            );
          })}

          {/* Títulos a validar sin comprobante asociado: la contacta mandó algo
              para acreditarse que la IA no dio por bueno, pero todavía no hay un
              comprobante que lo agrupe. */}
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
                  <div className="flex items-start justify-between gap-2 pb-3">
                    <p className="truncate text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
                      {tr.conversation?.displayName ?? "Contacta sin nombre"}
                    </p>
                    <span className="flex shrink-0 items-center gap-1 badge-pill border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
                      <GraduationCap className="h-3 w-3 text-warn" strokeWidth={1.75} />
                      Sin comprobante
                    </span>
                  </div>

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
                      label="Mensaje de la contacta sobre el título"
                    />
                  )}

                  {tr.conversation && (
                    <div className="mt-4 flex items-center border-t border-neutral-100 pt-3 dark:border-neutral-800">
                      <button
                        onClick={() => {
                          const url = ghlConversationUrl(tr.conversation);
                          if (url) window.open(url, "_blank", "noopener,noreferrer");
                          else router.push(`/conversations?id=${tr.conversation!.id}`);
                        }}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        Ver conversación
                        <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
