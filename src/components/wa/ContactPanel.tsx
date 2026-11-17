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
  Flag,
  GraduationCap,
  Loader2,
  Mail,
  Phone,
  X,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatPhone } from "@/lib/search";
import { Avatar } from "../Avatar";
import type {
  ContactEvent,
  ContactFicha,
  ContactFile,
} from "@/app/api/wa/contact/[conversationId]/route";
import { FileReviewModal, fileStatusLabel } from "./FileReviewModal";

// Ficha del contacto, al costado del chat: quién es y qué nos llegó de ella
// para cada evento (comprobante, pago, acceso al curso), más su título
// profesional, reclamos de certificado y derivaciones. Los comprobantes y
// títulos se ven en miniatura y, al abrirlos, se aprueban o rechazan ahí mismo
// (FileReviewModal, mismas rutas que Aprobaciones). Dar acceso sigue en
// Aprobaciones; la ficha lleva ahí.

type Tone = "ok" | "warn" | "bad" | "idle";

interface Step {
  label: string;
  detail: string;
  tone: Tone;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
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

function stepsFor(ev: ContactEvent): Step[] {
  const p = ev.payment;
  const amount = fmtAmount(p.amount, p.currency);
  const steps: Step[] = [];

  steps.push(
    p.stage === "none"
      ? { label: "Comprobante", detail: "Todavía no lo envió", tone: "idle" }
      : {
          label: "Comprobante",
          detail: [
            `Recibido el ${fmtDate(p.receivedAt)}`,
            // Con el pago aprobado, el monto va en ese paso (puede ser la suma
            // de varios comprobantes).
            p.stage === "validated" ? null : amount,
            p.count > 1 ? `${p.count} envíos` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          tone: "ok",
        },
  );

  const payment: Step =
    p.stage === "validated"
      ? {
          label: "Pago aprobado",
          detail: [
            fmtDate(p.validatedAt) || null,
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
          ? { label: "Pago", detail: "Retenido hasta validar el título profesional", tone: "warn" }
          : p.stage === "rejected"
            ? { label: "Pago rechazado", detail: "El comprobante no se aprobó", tone: "bad" }
            : { label: "Pago", detail: "Pendiente", tone: "idle" };
  steps.push(payment);

  const a = ev.access;
  if (a.stage !== "not_applicable") {
    steps.push(
      a.stage === "granted"
        ? { label: "Acceso al curso", detail: `Dado el ${fmtDate(a.grantedAt)}`, tone: "ok" }
        : a.stage === "missing"
          ? { label: "Acceso al curso", detail: "Falta darlo", tone: "warn" }
          : a.stage === "missing_email"
            ? { label: "Acceso al curso", detail: "Falta su correo para darlo", tone: "warn" }
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
        const label = `${f.kind === "comprobante" ? "Comprobante" : "Título"}: ${st.text}`;
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
          </button>
        );
      })}
    </div>
  );
}

function EventCard({
  ev,
  paymentsHref,
  files,
  onOpenFile,
}: {
  ev: ContactEvent;
  paymentsHref: string;
  files: ContactFile[];
  onOpenFile: (f: ContactFile) => void;
}) {
  const steps = stepsFor(ev);
  const date = fmtEventDate(ev.eventAt);
  const needsAction =
    ev.payment.extraPending > 0 ||
    ev.payment.stage === "pending" ||
    ev.payment.stage === "awaiting_title" ||
    ev.access.stage === "missing" ||
    ev.access.stage === "missing_email";
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 px-4 py-4 dark:border-neutral-800">
      <h3 className="mb-2.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function StatusLine({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const dot =
    tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-red-500" : "bg-neutral-300 dark:bg-neutral-700";
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function ContactPanel({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [ficha, setFicha] = useState<ContactFicha | null>(null);
  const [error, setError] = useState<string | null>(null);
  // La conversación no existe (link roto): la ficha no tiene nada que mostrar.
  const [missing, setMissing] = useState(false);
  // Comprobante o título abierto en el modal de revisión.
  const [openFile, setOpenFile] = useState<ContactFile | null>(null);

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

  if (missing) return null;

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-neutral-900/40 backdrop-blur-sm xl:hidden" onClick={onClose} />
      <aside
        aria-label="Ficha del contacto"
        className="fixed inset-y-0 right-0 z-[60] flex h-full w-[340px] max-w-[92vw] shrink-0 flex-col border-l border-neutral-200 bg-white xl:static xl:z-auto dark:border-neutral-800 dark:bg-neutral-950"
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

            <Section title="Eventos">
              {ficha.events.length === 0 ? (
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  No hay eventos en venta ni comprobantes de esta persona
                </p>
              ) : (
                <div className="space-y-2.5">
                  {ficha.events.map((ev) => (
                    <EventCard
                      key={ev.key}
                      ev={ev}
                      paymentsHref={paymentsHref}
                      files={ficha.files.filter(
                        (f) => f.kind === "comprobante" && (f.eventSlug ?? "sin-evento") === ev.key,
                      )}
                      onOpenFile={setOpenFile}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title="Título profesional">
              <div className="flex items-start gap-2.5">
                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                <div className="min-w-0">
                  {ficha.title.stage === "none" ? (
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                      {ficha.events.some((e) => e.payment.stage === "awaiting_title")
                        ? "Todavía no lo envió. Tiene un pago retenido hasta validarlo"
                        : c!.isCustomer
                          ? "Ya estaba registrada, no hizo falta pedirlo"
                          : "No lo envió"}
                    </p>
                  ) : (
                    <>
                      <p className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">
                        {ficha.title.titleName ?? "Título enviado"}
                      </p>
                      {ficha.title.institution && (
                        <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                          {ficha.title.institution}
                        </p>
                      )}
                      <div className="mt-1">
                        <StatusLine
                          tone={ficha.title.stage === "valid" ? "ok" : ficha.title.stage === "review" ? "warn" : "bad"}
                        >
                          {ficha.title.stage === "valid"
                            ? "Validado"
                            : ficha.title.stage === "review"
                              ? "Para revisar en Aprobaciones"
                              : "No se dio por válido"}
                        </StatusLine>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <FileThumbs
                files={ficha.files.filter((f) => f.kind === "titulo")}
                onOpen={setOpenFile}
              />
            </Section>

            {ficha.certificados.length > 0 && (
              <Section title="Reclamos de certificado">
                <ul className="space-y-2.5">
                  {ficha.certificados.map((n) => (
                    <li key={n.id} className="flex items-start gap-2.5">
                      <Award className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                      <div className="min-w-0">
                        {n.summary && (
                          <p className="line-clamp-3 text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                            {n.summary}
                          </p>
                        )}
                        <div className="mt-1">
                          <StatusLine tone={n.resolvedAt ? "ok" : "warn"}>
                            {n.resolvedAt ? `Atendido el ${fmtDate(n.resolvedAt)}` : `Pendiente desde el ${fmtDate(n.createdAt)}`}
                          </StatusLine>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {ficha.derivaciones.length > 0 && (
              <Section title="Derivaciones al equipo">
                <ul className="space-y-2.5">
                  {ficha.derivaciones.slice(0, 4).map((n) => (
                    <li key={n.id} className="flex items-start gap-2.5">
                      <Flag className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                      <div className="min-w-0">
                        {n.summary && (
                          <p
                            title={n.summary}
                            className="line-clamp-3 text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200"
                          >
                            {n.summary}
                          </p>
                        )}
                        <div className="mt-1">
                          <StatusLine tone={n.resolvedAt ? "ok" : "warn"}>
                            {n.resolvedAt ? `Atendida el ${fmtDate(n.resolvedAt)}` : `Pendiente desde el ${fmtDate(n.createdAt)}`}
                          </StatusLine>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {ficha.derivaciones.length > 4 && (
                  <p className="mt-2.5 text-[11.5px] text-neutral-400 dark:text-neutral-500">
                    Y {ficha.derivaciones.length - 4} más antiguas
                  </p>
                )}
              </Section>
            )}
          </div>
        )}
      </aside>
      {openFile && (
        <FileReviewModal
          file={openFile}
          onClose={() => setOpenFile(null)}
          onDone={() => void load()}
        />
      )}
    </>
  );
}
