"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ArrowRight,
  Award,
  Check,
  Clock,
  Copy,
  FileText,
  GraduationCap,
  Loader2,
  Mail,
  Phone,
  X,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { SIN_TIENDUP_LABEL, datedStatus, titleStep } from "@/lib/payments/card-steps";
import { formatPhone } from "@/lib/search";
import { Avatar } from "../Avatar";
import type { Tone } from "./contact-blocks";
import type {
  ContactEvent,
  ContactFicha,
  ContactFile,
} from "@/app/api/wa/contact/[conversationId]/route";
import {
  InterventionItem,
  Section,
  ShowMoreList,
  StatusLine,
  SubHeading,
  TiendupLiveBlock,
  TitleStatusRow,
  fmtShortDate,
  tiendupHasRed,
  useTiendupStatus,
} from "./contact-blocks";
import {
  FileReviewModal,
  canReviewFile,
  fileStatusLabel,
  type FileReviewIntent,
} from "./FileReviewModal";

// Ficha del contacto, al costado del chat: quién es y qué nos llegó de ella
// para cada evento (comprobante, pago, acceso al curso), más su título
// profesional, reclamos de certificado y derivaciones. Los comprobantes y
// títulos se ven en miniatura y, al abrirlos, se aprueban o rechazan ahí mismo
// (FileReviewModal, mismas rutas PATCH que Aprobaciones y /revision). Lo que
// está pendiente lleva además botones Aprobar / Rechazar a la vista: abren el
// mismo modal con el archivo y la confirmación de esa acción. Dar acceso sigue
// en Aprobaciones; la ficha lleva ahí.
//
// Orden (D-65): arriba lo que está en curso (eventos con algo pendiente y
// títulos por revisar), después las intervenciones abiertas con su detalle y
// el estado del título, el bloque de Tiendup en vivo (arriba de todo si hay
// un curso en rojo) y al final el historial, de a 3 por categoría.


interface Step {
  label: string;
  detail: string;
  tone: Tone;
}

function fmtEventDate(iso: string | null): string | null {
  if (!iso) return null;
  const label = new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtAmount(amount: number | null, currency: string | null): string | null {
  if (amount === null) return null;
  const cur = currency === "USD" ? "USD " : "$";
  return `${cur}${Math.round(amount).toLocaleString("es-AR")}`;
}

function stepsFor(ev: ContactEvent, title: ContactFicha["title"], isCustomer: boolean, historical: boolean): Step[] {
  const p = ev.payment;
  const amount = fmtAmount(p.amount, p.currency);
  const steps: Step[] = [];

  steps.push(
    p.stage === "none"
      ? { label: "Comprobante", detail: "Todavía no lo envió", tone: "idle" }
      : {
          label: "Comprobante",
          detail: [
            datedStatus("Recibido", p.receivedAt),
            // Con el pago aprobado, el monto va en ese paso (puede ser la suma
            // de varios comprobantes).
            p.stage === "validated" ? null : amount,
          ]
            .filter(Boolean)
            .join(" · "),
          tone: "ok",
        },
  );

  const titleStatus = titleStep(title.stage === "none" && isCustomer ? "exempt" : title.stage, {
    now: Date.now(),
    reviewedAt: historical ? null : title.reviewedAt,
    waiting: p.stage === "awaiting_title",
    historical: historical && p.stage === "validated",
  });
  const tones: Record<typeof titleStatus.status, Tone> = { done: "ok", current: "warn", future: "idle", error: "bad" };
  steps.push({ label: titleStatus.label, detail: titleStatus.detail, tone: tones[titleStatus.status] });

  const payment: Step =
    p.stage === "validated"
      ? {
          label: "Pago",
          detail: [
            datedStatus("Aprobado", p.validatedAt),
            amount,
            p.validatedCount > 1 ? `en ${p.validatedCount} pagos` : null,
            p.deliveryFailed ? "no se le pudo avisar por WhatsApp" : null,
            p.extraPending > 0
              ? p.extraPending === 1
                ? "hay otro comprobante sin revisar"
                : `hay ${p.extraPending} comprobantes sin revisar`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Aprobado por el equipo",
          tone: "ok",
        }
      : p.stage === "pending"
        ? { label: "Pago", detail: "Esperando aprobación del equipo", tone: "warn" }
        : p.stage === "awaiting_title"
          ? { label: "Pago", detail: "Después de validar el título", tone: "idle" }
          : p.stage === "rejected"
            ? { label: "Pago", detail: "Rechazado", tone: "bad" }
            : { label: "Pago", detail: "Pendiente", tone: "idle" };
  steps.push(payment);

  const a = ev.access;
  if (a.stage !== "not_applicable") {
    steps.push(
      a.stage === "granted"
        ? { label: "Acceso al curso", detail: datedStatus("Dado", a.grantedAt), tone: "ok" }
        : a.stage === "missing"
          ? { label: "Acceso al curso", detail: "Falta darlo", tone: "warn" }
          : a.stage === "missing_email"
            ? { label: "Acceso al curso", detail: "Falta el mail", tone: "warn" }
            : a.stage === "no_tiendup"
              ? { label: "Acceso al curso", detail: SIN_TIENDUP_LABEL, tone: "idle" }
            : a.stage === "closed"
              ? { label: "Acceso al curso", detail: "El curso ya cerró", tone: "idle" }
              : { label: "Acceso al curso", detail: "Después de aprobar el pago", tone: "idle" },
    );
  }
  return steps;
}

function StepIcon({ tone }: { tone: Tone }) {
  const base = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full";
  if (tone === "ok") {
    return (
      <span className={`${base} bg-ok/15 text-ok-fg dark:text-ok`}>
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  }
  if (tone === "warn") {
    return (
      <span className={`${base} bg-warn/15 text-warn-fg dark:text-warn`}>
        <Clock className="h-3 w-3" strokeWidth={2.25} />
      </span>
    );
  }
  if (tone === "bad") {
    return (
      <span className={`${base} bg-red-500/15 text-red-700 dark:text-red-400`}>
        <X className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  }
  return <span className={`${base} border border-dashed border-neutral-300 dark:border-neutral-700`} />;
}

/** Miniaturas clickeables de comprobantes o títulos. */
function FileThumbs({
  files,
  onOpen,
}: {
  files: ContactFile[];
  onOpen: (f: ContactFile) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {files.map((f) => {
        const st = fileStatusLabel(f);
        const ring =
          st.tone === "warn"
            ? "border-warn/60"
            : st.tone === "ok"
              ? "border-ok/40"
              : st.tone === "bad"
                ? "border-red-500/40"
                : "border-neutral-200 dark:border-neutral-800";
        const label = `${f.kind === "comprobante" ? "Comprobante" : "Título"}: ${st.text}${
          (f.images?.length ?? 0) > 1 ? ` · ${f.images!.length} imágenes` : ""
        }`;
        return (
          <button
            key={f.id}
            onClick={() => onOpen(f)}
            title={label}
            aria-label={label}
            className={`relative h-14 w-12 overflow-hidden rounded-lg border bg-neutral-50 transition hover:opacity-90 hover:shadow-gold dark:bg-neutral-900/40 ${ring} ${
              f.status === "dismissed" ? "opacity-50" : ""
            }`}
          >
            {f.url && f.fileType !== "application/pdf" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-neutral-400 dark:text-neutral-500">
                <FileText className="h-4 w-4" strokeWidth={1.5} />
              </span>
            )}
            {st.tone === "warn" && (
              <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warn" />
            )}
            {(f.images?.length ?? 0) > 1 && (
              <span
                aria-hidden
                className="absolute bottom-0.5 right-0.5 rounded bg-neutral-900/70 px-1 font-mono text-[9.5px] tabular-nums text-white"
              >
                {f.images!.length}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type OpenFile = (f: ContactFile, intent?: FileReviewIntent) => void;

/**
 * Archivos pendientes con Aprobar / Rechazar a la vista. Cada botón abre el
 * modal de revisión (se ve el archivo) con la confirmación de esa acción.
 */
function PendingFileActions({ files, onOpen }: { files: ContactFile[]; onOpen: OpenFile }) {
  const pending = files.filter(canReviewFile);
  if (!pending.length) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {pending.map((f) => {
        const isPayment = f.kind === "comprobante";
        const amount = isPayment ? fmtAmount(f.amount, f.currency) : null;
        const images = f.images?.length ?? 0;
        const label = isPayment
          ? ["Comprobante", amount, images > 1 ? `${images} imágenes` : null].filter(Boolean).join(" · ")
          : f.titleName ?? "Título profesional";
        return (
          <li
            key={f.id}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/40"
          >
            <button
              onClick={() => onOpen(f)}
              title="Ver el archivo"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-neutral-700 transition hover:text-neutral-900 dark:text-neutral-200 dark:hover:text-neutral-50"
            >
              {isPayment ? (
                <FileText className="h-3.5 w-3.5 shrink-0 text-gold" strokeWidth={1.75} />
              ) : (
                <GraduationCap className="h-3.5 w-3.5 shrink-0 text-gold" strokeWidth={1.75} />
              )}
              <span className="truncate">{label}</span>
            </button>
            <button
              onClick={() => onOpen(f, "reject")}
              aria-label={isPayment ? "Rechazar comprobante" : "Rechazar título"}
              className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-red-700 transition hover:bg-red-600/[0.08] dark:text-red-300"
            >
              Rechazar
            </button>
            <button
              onClick={() => onOpen(f, "approve")}
              aria-label={isPayment ? "Aprobar comprobante" : "Validar título"}
              className="btn-gold flex shrink-0 items-center gap-1 !px-2.5 !py-1 !text-[12px]"
            >
              <Check className="h-3 w-3" strokeWidth={2.25} />
              {isPayment ? "Aprobar" : "Validar"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** El evento tiene algo para resolver: pago por aprobar o retenido, acceso por dar. */
function eventNeedsAction(ev: ContactEvent): boolean {
  return (
    ev.payment.extraPending > 0 ||
    ev.payment.stage === "pending" ||
    ev.payment.stage === "awaiting_title" ||
    ev.access.stage === "missing" ||
    ev.access.stage === "missing_email"
  );
}

function EventCard({
  ev,
  title,
  isCustomer,
  historical = false,
  paymentsHref,
  files,
  onOpenFile,
}: {
  ev: ContactEvent;
  title: ContactFicha["title"];
  isCustomer: boolean;
  historical?: boolean;
  paymentsHref: string;
  files: ContactFile[];
  onOpenFile: OpenFile;
}) {
  const steps = stepsFor(ev, title, isCustomer, historical);
  const date = fmtEventDate(ev.eventAt);
  const needsAction = eventNeedsAction(ev);
  return (
    <article
      className={`rounded-xl border p-3.5 ${
        ev.active
          ? "border-gold/40 bg-gold/[0.03] dark:border-gold/30"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-medium leading-snug text-neutral-900 dark:text-neutral-50">
            {ev.title}
          </h4>
          {date && (
            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">{date}</p>
          )}
        </div>
        <span
          className={`shrink-0 badge-pill ${
            ev.active
              ? "border-gold/40 bg-gold/10 text-gold-fg dark:text-gold"
              : "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400"
          }`}
        >
          {ev.active ? "En venta" : "Finalizado"}
        </span>
      </div>

      <ol className="mt-3">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex gap-2.5 pb-3 last:pb-0">
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[9.5px] top-5 h-[calc(100%-1.25rem)] w-px bg-neutral-200 dark:bg-neutral-800"
              />
            )}
            <StepIcon tone={s.tone} />
            <div className="min-w-0 pt-px">
              <p
                className={`text-[12px] font-medium leading-tight ${
                  s.tone === "idle"
                    ? "text-neutral-400 dark:text-neutral-500"
                    : "text-neutral-800 dark:text-neutral-100"
                }`}
              >
                {s.label}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-neutral-500 dark:text-neutral-400">
                {s.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <FileThumbs files={files} onOpen={onOpenFile} />
      <PendingFileActions files={files} onOpen={onOpenFile} />

      {needsAction && (
        <Link
          href={paymentsHref}
          className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Resolver en Aprobaciones
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      )}
    </article>
  );
}

export function ContactPanel({
  conversationId,
  onClose,
  embedded = false,
}: {
  conversationId: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [ficha, setFicha] = useState<ContactFicha | null>(null);
  const [error, setError] = useState<string | null>(null);
  // La conversación no existe (link roto): la ficha no tiene nada que mostrar.
  const [missing, setMissing] = useState(false);
  // Comprobante o título abierto en el modal de revisión (con la acción que
  // se eligió desde la ficha, si vino de los botones Aprobar / Rechazar).
  const [openFile, setOpenFile] = useState<{ file: ContactFile; intent?: FileReviewIntent } | null>(null);
  const openReview = useCallback<OpenFile>((file, intent) => setOpenFile({ file, intent }), []);
  // Estado de Tiendup en vivo: se pide una vez al abrir la ficha, si corresponde.
  const { status: tiendup, refresh: refreshTiendup } = useTiendupStatus(
    ficha?.conversation.id === conversationId ? conversationId : null,
    Boolean(ficha?.tiendupCheck),
  );

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/wa/contact/${conversationId}`, { cache: "no-store" });
      const j = await r.json();
      if (r.status === 404) {
        setMissing(true);
        return;
      }
      if (!r.ok) {
        setError(j.error ?? "No se pudo cargar la ficha");
        return;
      }
      setError(null);
      setFicha(j as ContactFicha);
    } catch {
      setError("Error de red");
    }
  }, [conversationId]);

  useEffect(() => {
    setFicha(null);
    void load();
    const supabase = getSupabaseBrowserClient();
    const filter = `conversation_id=eq.${conversationId}`;
    const channel = supabase
      .channel(`wa-ficha-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_validations", filter }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "professional_titles", filter }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_notifications", filter }, () => void load())
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, load]);

  function copy(value: string, what: string) {
    navigator.clipboard.writeText(value).then(
      () => toast.success(`${what} copiado`),
      () => toast.error("No se pudo copiar"),
    );
  }

  const c = ficha?.conversation;
  const phone = formatPhone(c?.phone ?? null);
  const paymentsHref = `/payments?q=${encodeURIComponent(c?.phone?.replace(/\D/g, "") || c?.displayName || "")}`;

  // --- Orden de la ficha (D-65) ---
  // 1. En curso: eventos con algo pendiente (o en venta y sin pago aprobado) y
  //    títulos por revisar. 2. Intervenciones abiertas + estado del título.
  // 3. Tiendup en vivo (arriba de todo si algún curso está en rojo).
  // 4. Historial: lo demás, de a 3 con "Ver más".
  const filesOf = (ev: ContactEvent) =>
    (ficha?.files ?? []).filter((f) => f.kind === "comprobante" && (f.eventSlug ?? "sin-evento") === ev.key);
  const events = ficha?.events ?? [];
  const isCurrent = (ev: ContactEvent) =>
    eventNeedsAction(ev) ||
    filesOf(ev).some(canReviewFile) ||
    (ev.active && ev.payment.stage !== "validated");
  const current = events.filter(isCurrent);
  const past = events.filter((ev) => !isCurrent(ev));
  const titleFiles = (ficha?.files ?? []).filter((f) => f.kind === "titulo");
  const pendingTitles = titleFiles.filter(canReviewFile);
  const openInterventions = [
    ...(ficha?.derivaciones ?? []),
    ...(ficha?.certificados ?? []),
  ]
    .filter((n) => !n.resolvedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closedInterventions = (ficha?.derivaciones ?? []).filter((n) => n.resolvedAt);
  const certificados = (ficha?.certificados ?? []).filter((n) => n.resolvedAt);
  const titleDetail = !ficha
    ? null
    : ficha.title.stage === "none"
      ? ficha.events.some((e) => e.payment.stage === "awaiting_title")
        ? "Tiene un pago retenido hasta validarlo"
        : c?.isCustomer
          ? "Alumna registrada"
          : null
      : [ficha.title.titleName, ficha.title.institution].filter(Boolean).join(" · ") || null;

  const tiendupBlock =
    tiendup.phase === "idle" || (tiendup.phase === "done" && !tiendup.data.show) ? null : (
      <Section title="Acceso a Tiendup">
        <TiendupLiveBlock
          fetchState={tiendup}
          email={c?.email ?? null}
          editor={{
            conversationId,
            email: c?.email ?? null,
            onChanged: () => {
              refreshTiendup();
              void load();
            },
          }}
        />
      </Section>
    );
  const tiendupRed = tiendupHasRed(tiendup);

  if (missing) return null;

  return (
    <>
      {!embedded && <div className="fixed inset-0 z-[55] bg-neutral-900/40 backdrop-blur-sm xl:hidden" onClick={onClose} />}
      <aside
        aria-label="Ficha del contacto"
        className={`flex h-full flex-col bg-white dark:bg-neutral-950 ${embedded ? "w-full" : "fixed inset-y-0 right-0 z-[60] w-[340px] max-w-[92vw] shrink-0 border-l border-neutral-200 xl:static xl:z-auto dark:border-neutral-800"}`}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-[13px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
            Ficha del contacto
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar ficha"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {!ficha ? (
          <div className="flex flex-1 items-center justify-center gap-2 px-4 text-center text-[13px] text-neutral-500">
            {error ? (
              <span>
                {error}{" "}
                <button onClick={() => void load()} className="underline underline-offset-2">
                  Reintentar
                </button>
              </span>
            ) : (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> Cargando ficha…
              </>
            )}
          </div>
        ) : (
          <div className="scroll-thin flex-1 overflow-y-auto">
            {/* Identidad */}
            <div className="px-4 pb-4 pt-2">
              <div className="flex items-center gap-3">
                <Avatar name={c!.displayName} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
                    {c!.displayName}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span
                      className={`badge-pill ${
                        c!.isCustomer
                          ? "border-ok/30 bg-ok/[0.08] text-ok-fg dark:text-ok"
                          : "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400"
                      }`}
                    >
                      {c!.isCustomer ? "Clienta" : "Sin registrar"}
                    </span>
                    {c!.mode === "HUMAN" && (
                      <span className="badge-pill border-warn/40 bg-warn/10 text-warn-fg dark:text-warn">
                        Con el equipo
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <dl className="mt-3.5 space-y-1.5">
                {phone && (
                  <div className="group/row flex items-center gap-2 text-[12px] text-neutral-700 dark:text-neutral-200">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                    <dd className="min-w-0 flex-1 truncate font-mono">{phone}</dd>
                    <button
                      onClick={() => copy(c!.phone ?? "", "Teléfono")}
                      aria-label="Copiar teléfono"
                      title="Copiar teléfono"
                      className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
                    >
                      <Copy className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[12px] text-neutral-700 dark:text-neutral-200">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                  {c!.email ? (
                    <>
                      <dd className="min-w-0 flex-1 truncate">{c!.email}</dd>
                      <button
                        onClick={() => copy(c!.email ?? "", "Correo")}
                        aria-label="Copiar correo"
                        title="Copiar correo"
                        className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
                      >
                        <Copy className="h-3 w-3" strokeWidth={1.75} />
                      </button>
                    </>
                  ) : (
                    <dd className="text-neutral-400 dark:text-neutral-500">Todavía no dejó su correo</dd>
                  )}
                </div>
              </dl>
            </div>

            {tiendupRed && tiendupBlock}

            <Section title="En curso">
              {current.length === 0 && pendingTitles.length === 0 ? (
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  Nada pendiente con esta persona
                </p>
              ) : (
                <div className="space-y-2.5">
                  {current.map((ev) => (
                    <EventCard
                      key={ev.key}
                      ev={ev}
                      title={ficha.title}
                      isCustomer={Boolean(c?.isCustomer)}
                      paymentsHref={paymentsHref}
                      files={filesOf(ev)}
                      onOpenFile={openReview}
                    />
                  ))}
                  {pendingTitles.length > 0 && (
                    <article className="rounded-xl border border-gold/40 bg-gold/[0.03] p-3.5 dark:border-gold/30">
                      <h4 className="flex items-center gap-1.5 text-[13px] font-medium leading-snug text-neutral-900 dark:text-neutral-50">
                        <GraduationCap className="h-3.5 w-3.5 text-gold" strokeWidth={1.75} />
                        Título profesional por revisar
                      </h4>
                      <PendingFileActions files={pendingTitles} onOpen={openReview} />
                    </article>
                  )}
                </div>
              )}
            </Section>

            <Section title="Intervención y título">
              {openInterventions.length === 0 ? (
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">Sin intervenciones abiertas</p>
              ) : (
                <ShowMoreList
                  items={openInterventions}
                  render={(n) => <InterventionItem key={n.id} n={n} open />}
                  className="space-y-3"
                />
              )}
              <div className="mt-3.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <TitleStatusRow stage={ficha.title.stage} detail={titleDetail} />
                <FileThumbs files={titleFiles} onOpen={openReview} />
              </div>
            </Section>

            {!tiendupRed && tiendupBlock}

            <Section title="Historial">
              {past.length === 0 && closedInterventions.length === 0 && certificados.length === 0 ? (
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">Sin historial</p>
              ) : (
                <div className="space-y-4">
                  {past.length > 0 && (
                    <div>
                      <SubHeading count={past.length}>Eventos</SubHeading>
                      <ShowMoreList
                        items={past}
                        render={(ev) => (
                          <EventCard
                            key={ev.key}
                            ev={ev}
                            title={ficha.title}
                            isCustomer={Boolean(c?.isCustomer)}
                            historical
                            paymentsHref={paymentsHref}
                            files={filesOf(ev)}
                            onOpenFile={openReview}
                          />
                        )}
                      />
                    </div>
                  )}
                  {closedInterventions.length > 0 && (
                    <div>
                      <SubHeading count={closedInterventions.length}>Derivaciones atendidas</SubHeading>
                      <ShowMoreList
                        items={closedInterventions}
                        render={(n) => <InterventionItem key={n.id} n={n} open={false} />}
                        className="space-y-3"
                      />
                    </div>
                  )}
                  {certificados.length > 0 && (
                    <div>
                      <SubHeading count={certificados.length}>Reclamos de certificado</SubHeading>
                      <ShowMoreList
                        items={certificados}
                        render={(n) => (
                          <div key={n.id} className="flex items-start gap-2.5">
                            <Award className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                            <div className="min-w-0">
                              {n.summary && (
                                <p className="whitespace-pre-line break-words text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                                  {n.summary}
                                </p>
                              )}
                              <div className="mt-1">
                                <StatusLine tone="ok">
                                  {`Atendido el ${fmtShortDate(n.resolvedAt)} · pedido el ${fmtShortDate(n.createdAt)}`}
                                </StatusLine>
                              </div>
                            </div>
                          </div>
                        )}
                      />
                    </div>
                  )}
                </div>
              )}
            </Section>
          </div>
        )}
      </aside>
      {openFile && (
        <FileReviewModal
          key={`${openFile.file.id}-${openFile.intent ?? "ver"}`}
          file={openFile.file}
          intent={openFile.intent}
          onClose={() => setOpenFile(null)}
          // Refresca la ficha; la lista se entera por atp:notifications-changed.
          onDone={() => void load()}
        />
      )}
    </>
  );
}
