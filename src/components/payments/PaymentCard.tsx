"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ExternalLink, MessageCircle } from "lucide-react";
import type { PaymentItem } from "@/app/api/payments/route";
import { normalizeContactEmail } from "@/lib/contact-email";
import { ghlConversationUrl } from "@/lib/ghl-link";
import { eventTitle, paymentStatusChip, titleDelivered, titleState } from "@/lib/payments/revision-card";
import { formatPhone } from "@/lib/search";
import { recipientMismatches } from "@/lib/payments/recipient";
import { useProfile } from "../ProfileProvider";
import { CardChip, TitleLine } from "./TitleLine";
import { Field, Thumb, fmtDateTime, fmtTransferDate } from "./receipt-fields";

const secondary = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

function CopyButton({ value }: { value: string }) {
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
    <button type="button" className={secondary} disabled={!value.trim()} onClick={() => void copy()}>
      <span aria-live="polite">{feedback || "Copiar"}</span>
    </button>
  );
}

function ContactFields({ conversationId, phone, email, onSaved }: {
  conversationId: string;
  phone: string | null;
  email: string | null;
  onSaved: () => void;
}) {
  const { profile } = useProfile();
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
    <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      {phone && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-neutral-500 dark:text-neutral-400">Teléfono</span>
          <span className="font-mono">{phone}</span>
          <CopyButton value={phone} />
        </div>
      )}
      <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-[1_1_12rem] flex-wrap items-center gap-2 text-[12px]">
          <span className="text-neutral-500 dark:text-neutral-400">Mail de Tiendup</span>
          <input
            type="email"
            required
            value={value}
            disabled={busy}
            onChange={(event) => { setDraft(event.target.value); setResult(null); }}
            placeholder="Cargá el mail de Tiendup"
            className="min-w-0 flex-[1_1_10rem] rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>
        <CopyButton value={value} />
        <button type="submit" className={secondary} disabled={busy || value.trim() === stored}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </form>
      {result && <p role="status" className={`text-[12px] ${result.ok ? "text-emerald-700 dark:text-ok" : "text-red-700 dark:text-red-300"}`}>{result.text}</p>}
    </div>
  );
}

export function PaymentCard({ payment: p, children, titleActions, onOpenChat, onSaved }: {
  payment: PaymentItem;
  children?: ReactNode;
  titleActions?: ReactNode;
  onOpenChat: (id: string) => void;
  onSaved: () => void;
}) {
  const status = paymentStatusChip[p.status];
  const event = eventTitle(p.eventSlug);
  const conv = p.conversation;
  const ghl = ghlConversationUrl(conv);
  const recipient = recipientMismatches(p.recipientName, p.recipientTaxId);
  const amount = p.amount === null ? null : `${p.currency ?? "ARS"} ${p.amount.toLocaleString("es-AR")}`;
  const name = conv?.displayName.trim();
  const delivered = titleDelivered(p.titles, p.titleExempt);
  const warnings = [
    p.groupMaybeDistinct && "Parecen pagos distintos. Revisá las imágenes antes de aprobar",
    p.isDuplicate && "N° repetido",
    recipient.length > 0 && "Destinatario no coincide con la cuenta de Vanesa Rúas",
    p.awaitingTitle && "Esperando título",
    p.deliveryFailed && "No se avisó al cliente. Enviá la confirmación desde GHL",
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <article className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <Thumb url={p.comprobanteUrl} type={p.comprobanteType} alt="Comprobante" className="h-20 w-14" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <h2 className="break-words text-[20px] font-medium leading-tight">
              {name && name !== "(sin nombre)" ? name : p.senderName ?? "Contacta sin nombre"}
            </h2>
            <CardChip tone={status.tone}>{status.label}</CardChip>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CardChip tone={event ? "ok" : "neutral"}>{event ?? "Evento sin identificar"}</CardChip>
            <CardChip tone={delivered ? "ok" : "neutral"}>
              Título entregado: {delivered ? "Sí" : "No"}
            </CardChip>
            {p.agendada !== null && (
              <CardChip tone={p.agendada ? "ok" : "warn"}>
                {p.agendada ? "Agendada" : "No agendada · Agendar en WhatsApp"}
              </CardChip>
            )}
          </div>
          {conv && (
            <button type="button" onClick={() => onOpenChat(conv.id)} className={secondary}>
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
              Ver conversación
            </button>
          )}
        </div>
      </div>

      {conv && <ContactFields key={conv.id} conversationId={conv.id} phone={formatPhone(conv.phone)} email={p.contactEmail} onSaved={onSaved} />}
      {p.previousMasterclasses.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-neutral-500 dark:text-neutral-400">Antes participó en:</span>
          {p.previousMasterclasses.map((label) => <CardChip key={label} tone="neutral">{label}</CardChip>)}
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
      <details className="rounded-lg border border-neutral-200 p-3 text-[12px] dark:border-neutral-800">
        <summary className="cursor-pointer font-medium">Detalle del comprobante{amount && ` · ${amount}`}</summary>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Fecha y hora" value={fmtTransferDate(p.transferredAt, p.transferDateRaw)} />
          <Field label="Banco / medio" value={p.bankOrMethod} />
          <Field label="N° de operación" value={p.operationNumber} />
          <Field label="Emisor" value={p.senderName} />
          <Field label="CUIT emisor" value={p.senderTaxId} />
          <Field label="Destinatario" value={p.recipientName} />
          <Field label="CUIT destinatario" value={p.recipientTaxId} />
          <Field label="Concepto" value={p.concept} />
          <Field label="Recibido" value={fmtDateTime(p.createdAt)} />
          <Field label="Nivel de lectura" value={p.extractionConfidence} />
          <Field label="Notas" value={p.validationNote} />
        </dl>
        {p.status !== "pending" && (
          <p className="mt-2 text-neutral-500 dark:text-neutral-400">
            {status.label} por {p.validatedByName ?? "el equipo"}{p.validatedAt && ` · ${fmtDateTime(p.validatedAt)}`}
          </p>
        )}
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
      <TitleLine state={titleState(p.titles, p.titleExempt)}>{titleActions}</TitleLine>
      {p.awaitingTitle && p.contactNote && (
        <div className="rounded-lg bg-neutral-50 p-3 text-[12px] dark:bg-neutral-950">
          <p className="font-medium">Último mensaje de la contacta</p>
          <p className="mt-1 break-words text-neutral-600 dark:text-neutral-400">{p.contactNote}</p>
        </div>
      )}
      {conv && (
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => onOpenChat(conv.id)} className={secondary}>
            Ver chat <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
          </button>
          {ghl && (
            <a href={ghl} target="_blank" rel="noopener noreferrer" className={secondary}>
              GHL <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            </a>
          )}
        </div>
      )}
      {children}
    </article>
  );
}
