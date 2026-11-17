"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Check, ExternalLink, FileText, GraduationCap, Loader2, X } from "lucide-react";
import { useProfile } from "../ProfileProvider";
import { eventBySlug } from "@/lib/payments/event-match";
import type { ContactFile } from "@/app/api/wa/contact/[conversationId]/route";

// Modal para ver un comprobante o un título desde la ficha de /wa y
// resolverlo ahí mismo. Usa las MISMAS rutas que Aprobaciones:
//   - comprobante: PATCH /api/payments/[id] (validar, rechazar; force para
//     aprobar uno retenido por título). Al validar corre el alta automática en
//     Tiendup y se cierran las notificaciones de pago, igual que en /payments.
//   - título: PATCH /api/titles/[id] (approve / reject).
// Rechazar pide confirmación, como en Aprobaciones. Esc y click afuera cierran
// (salvo con una acción en curso).

function fmtAmount(amount: number | null, currency: string | null): string | null {
  if (amount === null) return null;
  const cur = currency === "USD" ? "USD " : "$";
  return `${cur}${Math.round(amount).toLocaleString("es-AR")}`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, { text: string; tone: "ok" | "warn" | "bad" | "idle" }> = {
  pending: { text: "Pendiente de revisar", tone: "warn" },
  awaiting_title: { text: "Retenido hasta validar el título", tone: "warn" },
  validated: { text: "Aprobado", tone: "ok" },
  rejected: { text: "Rechazado", tone: "bad" },
  dismissed: { text: "Descartado, no era un comprobante", tone: "idle" },
  valid: { text: "Título validado", tone: "ok" },
  review: { text: "Título para revisar", tone: "warn" },
};

export function fileStatusLabel(f: ContactFile) {
  if (f.kind === "titulo" && f.status === "rejected") {
    return { text: "No se dio por válido", tone: "bad" as const };
  }
  return STATUS_LABEL[f.status] ?? { text: f.status, tone: "idle" as const };
}

export function FileReviewModal({
  file,
  onClose,
  onDone,
}: {
  file: ContactFile;
  onClose: () => void;
  /** Después de aprobar o rechazar: refrescar la ficha. */
  onDone: () => void;
}) {
  const { profile } = useProfile();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [confirm, setConfirm] = useState<"reject" | "force" | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || busy) return;
      if (confirm) setConfirm(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy, confirm]);

  const isPdf = file.fileType === "application/pdf";
  const isPayment = file.kind === "comprobante";
  const canAct = isPayment
    ? file.status === "pending" || file.status === "awaiting_title"
    : file.status === "review";
  const status = fileStatusLabel(file);
  const ev = isPayment ? eventBySlug(file.eventSlug) : null;
  const amount = fmtAmount(file.amount, file.currency);

  async function act(action: "approve" | "reject", force = false) {
    setBusy(action);
    try {
      const r = isPayment
        ? await fetch(`/api/payments/${file.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              status: action === "approve" ? "validated" : "rejected",
              validatedBy: profile?.id ?? null,
              ...(force ? { force: true } : {}),
            }),
          })
        : await fetch(`/api/titles/${file.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, reviewedBy: profile?.id ?? null }),
          });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error ?? "No se pudo actualizar");
        return;
      }
      if (isPayment && action === "approve" && j.deliveryFailed) {
        toast.error(
          "El pago se aprobó, pero no se le pudo avisar por WhatsApp (probable ventana de 24 h vencida). Quedó marcado en Aprobaciones",
          { duration: 8000 },
        );
      } else {
        toast.success(
          isPayment
            ? action === "approve"
              ? "Pago aprobado"
              : "Comprobante rechazado"
            : action === "approve"
              ? "Título validado"
              : "Título rechazado",
        );
      }
      onDone();
      onClose();
    } catch {
      toast.error("Error de red");
    } finally {
      setBusy(null);
    }
  }

  const dot =
    status.tone === "ok"
      ? "bg-ok"
      : status.tone === "warn"
        ? "bg-warn"
        : status.tone === "bad"
          ? "bg-red-500"
          : "bg-neutral-300 dark:bg-neutral-700";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isPayment ? "Comprobante" : "Título profesional"}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col glass rounded-xl border border-neutral-200 p-5 shadow-soft dark:border-neutral-800 dark:shadow-soft-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
              {isPayment ? (
                <FileText className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
              ) : (
                <GraduationCap className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
              )}
              {isPayment ? "Comprobante" : file.titleName ?? "Título profesional"}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              {[
                isPayment ? ev?.shortLabel ?? null : file.institution,
                amount,
                `Recibido ${fmtDateTime(file.createdAt)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <span className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              {status.text}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={Boolean(busy)}
            aria-label="Cerrar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
          {!file.url ? (
            <p className="py-16 text-[12px] text-neutral-500">No se pudo cargar el archivo</p>
          ) : isPdf ? (
            <object data={file.url} type="application/pdf" className="h-[62vh] w-full">
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 py-16 text-[12px] text-neutral-600 underline underline-offset-2 dark:text-neutral-300"
              >
                Abrir el PDF <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
              </a>
            </object>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.url}
              alt={isPayment ? "Comprobante" : "Título profesional"}
              className="max-h-[62vh] w-auto max-w-full object-contain"
            />
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          {file.url ? (
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              Abrir en otra pestaña
            </a>
          ) : (
            <span />
          )}

          {canAct &&
            (confirm === "reject" ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-300">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500 dark:text-red-400" strokeWidth={1.75} />
                  {isPayment ? "Rechazar este comprobante?" : "Rechazar este título?"}
                </span>
                <button
                  onClick={() => setConfirm(null)}
                  disabled={Boolean(busy)}
                  className="rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void act("reject")}
                  disabled={Boolean(busy)}
                  className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "reject" && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
                  Sí, rechazar
                </button>
              </div>
            ) : confirm === "force" ? (
              <div className="flex items-center gap-2">
                <span className="max-w-[260px] text-[12px] leading-snug text-neutral-600 dark:text-neutral-300">
                  Todavía no acreditó su título. Aprobar igual?
                </span>
                <button
                  onClick={() => setConfirm(null)}
                  disabled={Boolean(busy)}
                  className="rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void act("approve", true)}
                  disabled={Boolean(busy)}
                  className="btn-gold flex items-center gap-1.5"
                >
                  {busy === "approve" && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
                  Aprobar igual
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirm("reject")}
                  disabled={Boolean(busy)}
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-red-700 transition hover:bg-red-600/[0.08] disabled:opacity-40 dark:text-red-300"
                >
                  Rechazar
                </button>
                <button
                  onClick={() =>
                    file.status === "awaiting_title" ? setConfirm("force") : void act("approve")
                  }
                  disabled={Boolean(busy)}
                  className="btn-gold flex items-center gap-1.5"
                >
                  {busy === "approve" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                  {isPayment ? "Aprobar" : "Validar título"}
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
