"use client";

import { SIN_TIENDUP_LABEL } from "@/lib/payments/card-steps";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Flag, KeyRound, Loader2, Mail, MessageCircle } from "lucide-react";
import { FileReviewPanel } from "../wa/FileReviewModal";
import type { ContactEvent, ContactFicha, ContactNotification } from "@/app/api/wa/contact/[conversationId]/route";
import { eventBySlug } from "@/lib/payments/event-match";
import { interventionCategoryLabel, urgentIntervention } from "@/lib/intervention-category";
import { PaymentCard } from "../payments/PaymentCard";
import { Thumb, fmtDateTime } from "../payments/receipt-fields";
import { TitleLine } from "../payments/TitleLine";
import { titleFile, type ReviewItem } from "./review-items";
import {
  Section,
  TiendupLiveBlock,
  fmtShortDate,
  fmtRelative,
  notificationLabel,
  reasonText,
  useTiendupStatus,
  type Tone,
} from "../wa/contact-blocks";

function Dot({ tone }: { tone: Tone }) {
  const cls =
    tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-red-500" : "bg-neutral-300 dark:bg-neutral-700";
  return <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}

const fmtDate = fmtShortDate;

function accessLine(ev: ContactEvent): { text: string; tone: Tone; detail: string | null } {
  const a = ev.access;
  switch (a.stage) {
    case "granted":
      return { text: `Acceso dado el ${fmtDate(a.grantedAt)}`, tone: "ok", detail: null };
    case "missing":
      return a.error
        ? { text: "Alta pendiente", tone: "warn", detail: a.error }
        : { text: "Falta dar el acceso", tone: "warn", detail: null };
    case "missing_email":
      return { text: "Sin correo, falta pedírselo", tone: "warn", detail: a.error };
    case "no_tiendup":
      return { text: SIN_TIENDUP_LABEL, tone: "idle", detail: null };
    case "closed":
      return { text: "El curso ya cerró", tone: "idle", detail: null };
    case "waiting_payment":
      return {
        text: ev.payment.stage === "rejected" ? "Pago rechazado, sin acceso" : "Pendiente, después de aprobar el pago",
        tone: "idle",
        detail: null,
      };
    default:
      return { text: "No aplica", tone: "idle", detail: null };
  }
}

const linkCls =
  "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50";

function MarkAccess({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/payments/${paymentId}/grant-access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markOnly: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo marcar el acceso");
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo marcar el acceso");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 pl-3">
      {confirm ? (
        <>
          <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">Marcar el acceso como dado sin inscribir en Tiendup?</p>
          <div className="mt-1 flex gap-2">
            <button type="button" className={linkCls} disabled={busy} onClick={() => setConfirm(false)}>Cancelar</button>
            <button type="button" className="btn-gold" disabled={busy} onClick={() => void mark()}>
              {busy ? "Marcando…" : "Confirmar"}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className={linkCls} onClick={() => setConfirm(true)}>
          Ya le dimos el alta a mano en Tiendup
        </button>
      )}
      {error && <p role="alert" className="text-[11.5px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function OpenIntervention({ notification, onOpenChat }: {
  notification: ContactNotification;
  onOpenChat: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const summary = summaryRef.current;
    if (!summary || expanded) return;
    const measure = () => setClipped(summary.scrollHeight > summary.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(summary);
    return () => observer.disconnect();
  }, [expanded, notification.summary]);

  const urgent = urgentIntervention(notification.category);
  const category = interventionCategoryLabel(notification.category) || "Intervención abierta";
  const reason = reasonText(notification.reason) ?? notificationLabel(notification);
  return (
    <section className={`rounded-xl border border-l-2 px-3.5 py-3 ${urgent
      ? "border-red-600/25 border-l-red-500 bg-red-500/[0.05] dark:bg-red-500/[0.08]"
      : "border-amber-600/25 border-l-amber-500 bg-amber-500/[0.06] dark:bg-amber-500/[0.08]"}`}>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${urgent
        ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-warn"}`}>
        <Flag aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <h3 className="text-[13px] font-medium">{category}</h3>
        <time dateTime={notification.createdAt} title={fmtDateTime(notification.createdAt)}
          className="font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
          {fmtRelative(notification.createdAt)}
        </time>
      </div>
      {reason && reason !== category && <p className="mt-1 break-words text-[12px] font-medium">{reason}</p>}
      {notification.summary && (
        <p ref={summaryRef} id={`intervention-summary-${notification.id}`}
          className={`mt-1 whitespace-pre-line break-words text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-300 ${expanded ? "" : "line-clamp-3"}`}>
          {notification.summary}
        </p>
      )}
      {clipped && (
        <button type="button" aria-expanded={expanded} aria-controls={`intervention-summary-${notification.id}`}
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[11.5px] underline underline-offset-2">
          {expanded ? "Ver menos" : "Ver más"}
        </button>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={onOpenChat}
          className={`${linkCls} border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900`}>
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          Abrir en WhatsApp
        </button>
        <Link href="/interventions" className={linkCls}>
          Ir a Derivaciones
          <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
        </Link>
      </div>
    </section>
  );
}

export function ReviewDetail({
  item,
  refreshKey,
  onDone,
  onOpenChat,
}: {
  item: ReviewItem;
  /** Cambia cuando la lista se recarga: la ficha se vuelve a pedir. */
  refreshKey: number;
  onDone: () => void;
  onOpenChat: () => void;
}) {
  const convId = item.conversationId;
  const [ficha, setFicha] = useState<ContactFicha | null>(null);
  const [fichaError, setFichaError] = useState<string | null>(null);
  // Descarta respuestas de una persona anterior (cambio rápido de ítem).
  const convRef = useRef(convId);
  convRef.current = convId;

  const loadFicha = useCallback(async () => {
    if (!convId) return;
    try {
      const r = await fetch(`/api/wa/contact/${convId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (convRef.current !== convId) return;
      if (!r.ok) {
        setFichaError(r.status === 404 ? "No se encontró la conversación" : j.error ?? "No se pudo cargar la ficha");
        return;
      }
      setFichaError(null);
      setFicha(j as ContactFicha);
    } catch {
      if (convRef.current === convId) setFichaError("Error de red");
    }
  }, [convId]);

  // Al cambiar de persona se limpia; al recargar la lista se refresca en el lugar.
  useEffect(() => {
    setFicha(null);
    setFichaError(null);
  }, [convId]);
  useEffect(() => {
    void loadFicha();
  }, [loadFicha, refreshKey]);

  const { status: tiendup, refresh: refreshTiendup } = useTiendupStatus(
    ficha && ficha.conversation.id === convId ? convId : null,
    Boolean(ficha?.tiendupCheck),
  );

  const p = item.payment;
  const pendingTitles = p?.titles.filter((t) => t.hasFile && !t.isValid && !t.reviewedAt) ?? [];

  const open = ficha
    ? [
        ...ficha.derivaciones.filter((d) => !d.resolvedAt),
        ...ficha.certificados.filter((c) => !c.resolvedAt),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const cardEvent = eventBySlug(p?.eventSlug);
  const cardHasCourse = cardEvent && cardEvent.slug !== "congreso";
  const accessEvents = ficha
    ? ficha.events.filter((e) => e.kind === "masterclass" && e.payment.stage !== "none" &&
        (e.key !== p?.eventSlug || (e.access.markablePaymentId && e.access.markablePaymentId !== p.id)))
    : [];

  return (
    <div className="scroll-thin h-full min-h-0 overflow-y-auto">
      <div className="w-full max-w-[48rem]">
        <div className="flex flex-col gap-3 p-3 sm:p-4">
          {open.map((notification) => (
            <OpenIntervention key={notification.id} notification={notification} onOpenChat={onOpenChat} />
          ))}
          {p ? (
            <PaymentCard
              key={p.id}
              payment={p}
              onOpenChat={onOpenChat}
              onSaved={onDone}
              eventAt={ficha?.events.find((event) => event.key === p.eventSlug)?.eventAt}
              interventionCategory={open[0]?.category}
              forceAction={p.awaitingTitle && (
                <FileReviewPanel key={item.id} file={item.file} variant="inline" actionsOnly
                  secondaryApproval={pendingTitles.length > 0} onDone={onDone} />
              )}
              paymentActions={!p.awaitingTitle && (
                <FileReviewPanel key={item.id} file={item.file} variant="inline" actionsOnly
                  secondaryApproval={pendingTitles.length > 0} onDone={onDone} />
              )}
              titleActions={pendingTitles.length > 0 && (
                <div className="mt-2 space-y-3">
                  {pendingTitles.map((title) => (
                    <div key={title.id} className="flex items-start gap-3">
                      <Thumb url={title.url} type={title.fileType} alt="Título profesional" className="h-20 w-14 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="break-words text-[12px] font-medium">{title.titleName ?? "Título sin nombre leído"}</p>
                        <p className="break-words text-[11px] text-neutral-500 dark:text-neutral-400">
                          {[title.institution, `Recibido ${fmtDateTime(title.createdAt)}`].filter(Boolean).join(" · ")}
                        </p>
                        <FileReviewPanel file={titleFile(title)} variant="inline" actionsOnly onDone={onDone} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            />
          ) : (
            <>
              <TitleLine state={ficha?.title.stage ?? "review"} />
              {convId && (
                <button type="button" onClick={onOpenChat} className={`${linkCls} my-2 w-fit`}>
                  <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Ver conversación
                </button>
              )}
              <FileReviewPanel key={item.id} file={item.file} variant="inline" onDone={onDone} />
            </>
          )}
        </div>

        {!convId ? (
          <Section title="Contacto">
            <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
              Este archivo no tiene una conversación asociada
            </p>
          </Section>
        ) : !ficha ? (
          <Section title="Contacto">
            {fichaError ? (
              <p className="text-[12px] text-neutral-500">
                {fichaError}{" "}
                <button onClick={() => void loadFicha()} className="underline underline-offset-2">
                  Reintentar
                </button>
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> Cargando ficha…
              </p>
            )}
          </Section>
        ) : (
          <div className="flex flex-col">
            <Section title="Acceso a Tiendup">
              <TiendupLiveBlock
                fetchState={tiendup}
                email={null}
                editor={
                  convId
                    ? {
                        conversationId: convId,
                        email: ficha.conversation.email,
                        onChanged: () => {
                          refreshTiendup();
                          void loadFicha();
                        },
                      }
                    : undefined
                }
              />
              {!p && <div className={`${tiendup.phase === "idle" || (tiendup.phase === "done" && !tiendup.data.show) ? "" : "mt-3 "}flex items-center gap-2 text-[12px] text-neutral-700 dark:text-neutral-200`}>
                <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                {ficha.conversation.email ? (
                  <span className="min-w-0 truncate">{ficha.conversation.email}</span>
                ) : (
                  <span className="text-neutral-400 dark:text-neutral-500">Todavía no dejó su correo</span>
                )}
              </div>}
              {accessEvents.length === 0 ? (
                !cardHasCourse && <p className="mt-2.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                  Sin pagos de masterclass
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {accessEvents.map((ev) => {
                    const line = accessLine(ev);
                    return (
                      <li key={ev.key} className="flex items-start gap-2.5">
                        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium leading-snug text-neutral-800 dark:text-neutral-100">
                            {ev.title}
                          </p>
                          <span className="mt-0.5 flex items-start gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                            <Dot tone={line.tone} />
                            {line.text}
                          </span>
                          {line.detail && (
                            <p
                              title={line.detail}
                              className="mt-0.5 line-clamp-2 pl-3 text-[11px] text-neutral-500 dark:text-neutral-500"
                            >
                              {line.detail}
                            </p>
                          )}
                          {ev.access.markablePaymentId && (
                            <MarkAccess
                              key={ev.access.markablePaymentId}
                              paymentId={ev.access.markablePaymentId}
                              onDone={() => {
                                refreshTiendup();
                                void loadFicha();
                                onDone();
                              }}
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link href="/payments?filter=sin-acceso" className={`${linkCls} mt-2.5 w-fit`}>
                Aprobaciones · Falta acceso
                <ArrowRight className="h-3 w-3" strokeWidth={2} />
              </Link>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
