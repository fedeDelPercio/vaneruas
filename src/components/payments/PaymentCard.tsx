"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, MessageCircle, Quote } from "lucide-react";
import type { PaymentItem } from "@/app/api/payments/route";
import { normalizeContactEmail } from "@/lib/contact-email";
import { ghlConversationUrl } from "@/lib/ghl-link";
import { cardDate, cardSteps } from "@/lib/payments/card-steps";
import { eventBySlug } from "@/lib/payments/event-match";
import { formatPhone } from "@/lib/search";
import { recipientMismatches } from "@/lib/payments/recipient";
import { useProfile } from "../ProfileProvider";
import { CardChip, InterventionChip } from "./TitleLine";
import { AccessActions } from "./AccessActions";
import { PaymentStepper } from "./PaymentStepper";
import { Field, Thumb, fmtTransferDate } from "./receipt-fields";

const secondary = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

function CopyButton({ value, compact = false }: { value: string; compact?: boolean }) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Copiado");
    } catch {
      setFeedback("No se pudo copiar");
    }
    window.setTimeout(() => setFeedback(""), 1800);
  }
  return (
    <button type="button" className={compact ? `${secondary} !px-1.5` : secondary} disabled={!value.trim()} onClick={() => void copy()}>
      <span aria-live="polite">{feedback || "Copiar"}</span>
    </button>
  );
}

function ContactFields({ conversationId, phone, email, onSaved, inputRef }: {
  conversationId: string;
  phone: string | null;
  email: string | null;
  onSaved: () => void;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  const { profile } = useProfile();
  const emailId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedEmail, setSavedEmail] = useState<{ previous: string | null; value: string } | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const stored = savedEmail?.previous === email ? savedEmail.value : email ?? "";
  const value = draft ?? stored;
  async function save() {
    const normalized = normalizeContactEmail(value);
    if (!normalized) {
      setResult({ text: "Cargá un mail válido", ok: false });
      return;
    }
    if (!profile) {
      setResult({ text: "Elegí un perfil para continuar", ok: false });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/wa/contact/${conversationId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized, enroll: false, profileId: profile.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setResult({ text: data.error ?? "No se pudo guardar el mail", ok: false });
        return;
      }
      setSavedEmail({ previous: email, value: data.email ?? normalized });
      setDraft(null);
      setResult({ text: "Mail guardado", ok: true });
      onSaved();
    } catch {
      setResult({ text: "Error de red al guardar el mail", ok: false });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1">
      {phone && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-neutral-500 dark:text-neutral-400">Teléfono</span>
          <span className="font-mono">{phone}</span>
          <CopyButton value={phone} />
        </div>
      )}
      <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={emailId} className="basis-full text-[12px] text-neutral-500 dark:text-neutral-400">
          Mail de Tiendup
        </label>
        <input
          ref={inputRef}
          id={emailId}
          type="email"
          required
          value={value}
          disabled={busy}
          onChange={(event) => { setDraft(event.target.value); setResult(null); }}
          placeholder="Ingresá el mail"
          title={value || undefined}
          className="min-w-0 max-w-[21rem] flex-[1_1_8rem] rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] outline-none dark:border-neutral-700 dark:bg-neutral-950"
        />
        <div className="flex flex-wrap items-center gap-1">
          <CopyButton value={value} compact />
          <button type="submit" className={`${secondary} !px-1.5`} disabled={busy || value.trim() === stored}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
      {result && <p role="status" className={`text-[12px] ${result.ok ? "text-emerald-700 dark:text-ok" : "text-red-700 dark:text-red-300"}`}>{result.text}</p>}
    </div>
  );
}

export function PaymentCard({ payment: p, children, titleActions, forceAction, paymentActions, eventAt, interventionCategory, onOpenChat, onSaved, onAccessSaved }: {
  payment: PaymentItem;
  children?: ReactNode;
  titleActions?: ReactNode;
  forceAction?: ReactNode;
  paymentActions?: ReactNode;
  eventAt?: string | null;
  onAccessSaved?: (message?: string) => void;
  interventionCategory?: string;
  onOpenChat: (id: string) => void;
  onSaved: () => void;
}) {
  const event = eventBySlug(p.eventSlug);
  const eventDate = cardDate(eventAt ?? event?.eventDate);
  const emailInput = useRef<HTMLInputElement>(null);
  const steps = cardSteps(p, Date.now());
  const title = steps[0];
  const access = steps.find((step) => step.key === "access");
  const conv = p.conversation;
  const ghl = ghlConversationUrl(conv);
  const recipient = recipientMismatches(p.recipientName, p.recipientTaxId);
  const amount = p.amount === null ? null : `${p.currency ?? "ARS"} ${p.amount.toLocaleString("es-AR")}`;
  const name = conv?.displayName.trim();
  const warnings = [
    p.groupMaybeDistinct && "Parecen pagos distintos. Revisá las imágenes antes de aprobar",
    p.isDuplicate && "N° repetido",
    recipient.length > 0 && "Destinatario no coincide con la cuenta de Vanesa Rúas",
    p.deliveryFailed && "No se avisó al cliente. Enviá la confirmación desde GHL",
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <article className="[container-type:inline-size] w-full max-w-[46rem] space-y-2.5 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="space-y-2">
        <h2 className="break-words text-[20px] font-medium leading-tight">
          {name && name !== "(sin nombre)" ? name : p.senderName ?? "Contacta sin nombre"}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {event ? <CardChip tone="ok">{event.label}{eventDate && ` ·\u00a0${eventDate.replace(" ", "\u00a0")}`}</CardChip>
            : <span className="text-[12px] text-neutral-500 dark:text-neutral-400">Evento sin identificar</span>}
          {p.agendada !== null && (
            <CardChip tone={p.agendada ? "ok" : "warn"}>
              {p.agendada ? "Agendada" : "No agendada · Agendar en WhatsApp"}
            </CardChip>
          )}
          {interventionCategory !== undefined && <InterventionChip category={interventionCategory} />}
        </div>
      </header>

      <div className="grid gap-3 border-t border-neutral-200 pt-2.5 [@container(min-width:37rem)]:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] dark:border-neutral-800">
        <PaymentStepper steps={steps} slots={{
          title: <>{titleActions}{title?.actions?.includes("force") && forceAction}</>,
          payment: paymentActions,
          access: access && <AccessActions step={access} paymentId={p.id} savedError={p.courseAccessQueued ? null : p.courseAccessError}
            onFocusEmail={conv ? () => emailInput.current?.focus() : undefined} onSaved={onAccessSaved ?? onSaved} />,
        }} />
        <div className="min-w-0 space-y-2.5 border-t border-neutral-200 pt-2 [@container(min-width:37rem)]:border-l [@container(min-width:37rem)]:border-t-0 [@container(min-width:37rem)]:pl-3 [@container(min-width:37rem)]:pt-0 dark:border-neutral-800">
          {conv && <ContactFields key={conv.id} conversationId={conv.id} phone={formatPhone(conv.phone)} email={p.contactEmail} onSaved={onSaved} inputRef={emailInput} />}
          {p.previousMasterclasses.length > 0 && (
            <div className="text-[11.5px]">
              <p className="text-neutral-500 dark:text-neutral-400">Antes participó en</p>
              <ul className="mt-0.5 space-y-0.5 text-neutral-700 dark:text-neutral-300">
                {p.previousMasterclasses.map((label) => <li key={label}>{label}</li>)}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="space-y-1 text-[12px] text-amber-800 dark:text-warn">
              {warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {warning}
                </li>
              ))}
            </ul>
          )}
          {p.status === "pending" && p.contactHasValidatedPayment && (
            <p className="text-[12px] text-neutral-600 dark:text-neutral-400">La contacta ya tiene otro pago aprobado</p>
          )}
          <details className="rounded-lg border border-neutral-200 px-3 py-2 text-[12px] dark:border-neutral-800">
            <summary className="cursor-pointer font-medium">Detalle del comprobante{amount && ` · ${amount}`}</summary>
            <div className="mt-2"><Thumb url={p.comprobanteUrl} type={p.comprobanteType} alt="Comprobante" className="h-20 w-14" /></div>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Fecha y hora" value={fmtTransferDate(p.transferredAt, p.transferDateRaw)} />
              <Field label="Banco / medio" value={p.bankOrMethod} />
              <Field label="N° de operación" value={p.operationNumber} />
              <Field label="Emisor" value={p.senderName} />
              <Field label="CUIT emisor" value={p.senderTaxId} />
              <Field label="Destinatario" value={p.recipientName} />
              <Field label="CUIT destinatario" value={p.recipientTaxId} />
              <Field label="Concepto" value={p.concept} />
              <Field label="Nivel de lectura" value={p.extractionConfidence} />
              <Field label="Notas" value={p.validationNote} />
            </dl>
            {p.validatedByName && <p className="mt-2 text-neutral-500 dark:text-neutral-400">Revisado por {p.validatedByName}</p>}
            {p.groupImages.length > 1 && (
              <div className="mt-3">
                <p className="mb-1">Otras imágenes</p>
                <div className="flex flex-wrap gap-1">
                  {p.groupImages.filter((image) => image.id !== p.id).map((image) => (
                    <Thumb key={image.id} url={image.url} type={image.fileType} alt="Otra imagen del mismo pago" className="h-12 w-10" />
                  ))}
                </div>
              </div>
            )}
          </details>
          {conv && (
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => onOpenChat(conv.id)} className={`${secondary} -ml-2.5`}>
                <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                Ver conversación
              </button>
              {ghl && <a href={ghl} target="_blank" rel="noopener noreferrer" className={secondary}>
                GHL <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
              </a>}
            </div>
          )}
          {p.contactNote && (
            <div className="flex items-start gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
              <Quote aria-label="Último mensaje" className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} />
              <p className="line-clamp-2 break-words italic">{p.contactNote}</p>
            </div>
          )}
          {children}
        </div>
      </div>
    </article>
  );
}
