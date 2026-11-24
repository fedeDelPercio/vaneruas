"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  GraduationCap,
  Loader2,
  Maximize2,
  X,
} from "lucide-react";
import { useProfile } from "../ProfileProvider";
import { MediaViewerModal, ViewerModal } from "../FileViewerModal";
import { eventBySlug } from "@/lib/payments/event-match";
import type { ContactFile } from "@/app/api/wa/contact/[conversationId]/route";

// Modal para ver un comprobante o un título desde la ficha de /wa y
// resolverlo ahí mismo. Usa las MISMAS rutas que Aprobaciones:
//   - comprobante: PATCH /api/payments/[id] (validar, rechazar; force para
//     aprobar uno retenido por título). Al validar corre el alta automática en
//     Tiendup y se cierran las notificaciones de pago, igual que en /payments.
//   - título: PATCH /api/titles/[id] (approve / reject).
// Rechazar pide confirmación, como en Aprobaciones. El contenedor es el visor
// modal único del panel (ViewerModal): X, Esc y click afuera cierran (salvo
// con una acción en curso).
//
// El contenido (archivo + botones) vive en FileReviewPanel, que también usa
// /revision en línea, sin modal. Ahí el archivo se amplía en el mismo visor
// (MediaViewerModal), sin abrir otra pestaña.

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

export type FileReviewAction = "approve" | "reject";

/** Confirmación con la que abre el panel (botones Aprobar / Rechazar de la ficha). */
export type FileReviewIntent = FileReviewAction;

/** El archivo todavía se puede aprobar o rechazar. */
export function canReviewFile(f: ContactFile): boolean {
  return f.kind === "comprobante"
    ? f.status === "pending" || f.status === "awaiting_title"
    : f.status === "review";
}

/**
 * Archivo (imagen o PDF) con Aprobar / Rechazar. Se usa dentro del modal de la
 * ficha (variant "modal") y en la columna derecha de /revision ("inline").
 */
export function FileReviewPanel({
  file,
  variant,
  onDone,
  onClose,
  onStateChange,
  intent,
  actionsOnly = false,
}: {
  file: ContactFile;
  actionsOnly?: boolean;
  variant: "modal" | "inline";
  /**
   * Abre directo en la confirmación de esa acción (la ficha tiene sus propios
   * botones Aprobar / Rechazar: se ve el archivo y se confirma acá).
   */
  intent?: FileReviewIntent;
  /** Después de aprobar o rechazar con éxito. */
  onDone: (action: FileReviewAction) => void;
  /** Solo en el modal: botón de cerrar de la cabecera. */
  onClose?: () => void;
  /** Avisa si hay una acción en curso o una confirmación abierta. */
  onStateChange?: (state: { busy: boolean; confirming: boolean }) => void;
}) {
  const { profile } = useProfile();
  const [busy, setBusy] = useState<FileReviewAction | null>(null);
  const [confirm, setConfirm] = useState<"reject" | "force" | "approve" | null>(() =>
    !intent || !canReviewFile(file)
      ? null
      : intent === "reject"
        ? "reject"
        : file.status === "awaiting_title"
          ? "force"
          : "approve",
  );

  useEffect(() => {
    onStateChange?.({ busy: Boolean(busy), confirming: Boolean(confirm) });
  }, [busy, confirm, onStateChange]);

  // Esc cancela la confirmación abierta (el modal, si lo hay, no se cierra).
  useEffect(() => {
    if (!confirm) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setConfirm(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirm, busy]);

  const isPayment = file.kind === "comprobante";
  // Varias imágenes del mismo pago (grouping.ts): se ven de a una, con
  // navegación, y se aprueban o rechazan juntas (la PATCH resuelve el grupo).
  const images = isPayment && (file.images?.length ?? 0) > 1 ? file.images! : null;
  const [imgIdx, setImgIdx] = useState(0);
  const shown = images ? images[Math.min(imgIdx, images.length - 1)]! : { url: file.url, fileType: file.fileType };
  const shownUrl = shown.url;
  const isPdf = shown.fileType === "application/pdf";
  const groupSuffix = images ? ` (${images.length} imágenes)` : "";
  const canAct = canReviewFile(file);
  const status = fileStatusLabel(file);
  const ev = isPayment ? eventBySlug(file.eventSlug) : null;
  const amount = fmtAmount(file.amount, file.currency);
  const inline = variant === "inline";
  // /revision: el archivo se amplía en el visor modal.
  const [viewerOpen, setViewerOpen] = useState(false);

  async function act(action: FileReviewAction, force = false) {
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
      setConfirm(null);
      // La lista de /wa y los contadores escuchan este evento para refrescar.
      window.dispatchEvent(new Event("atp:notifications-changed"));
      onDone(action);
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
    <div className="flex min-h-0 flex-1 flex-col">
      {!actionsOnly && <>
      <div className={`flex items-start justify-between gap-3 ${inline ? "" : "pr-10"}`}>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
            {isPayment ? (
              <FileText className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
            ) : (
              <GraduationCap className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
            )}
            <span className="truncate">
              {isPayment ? "Comprobante" : file.titleName ?? "Título profesional"}
            </span>
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {[
              isPayment ? ev?.shortLabel ?? null : file.institution,
              amount,
              `Recibido ${fmtDateTime(file.createdAt)}`,
              images ? `${images.length} imágenes del mismo pago` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <span className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            {status.text}
          </span>
          {file.maybeDistinct && (
            <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
              <AlertTriangle className="h-3 w-3 shrink-0 text-warn" strokeWidth={1.75} />
              Los montos leídos no coinciden, puede que sean pagos distintos
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            disabled={Boolean(busy)}
            aria-label="Cerrar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div
        className={`mt-4 flex items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 ${
          inline ? "min-h-[220px] flex-1" : "min-h-0 flex-1"
        }`}
      >
        {!shownUrl ? (
          <p className="py-16 text-[12px] text-neutral-500">No se pudo cargar el archivo</p>
        ) : isPdf ? (
          <object
            data={shownUrl}
            type="application/pdf"
            className={inline ? "h-[55vh] w-full" : "h-[62vh] w-full"}
          >
            <a
              href={shownUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 py-16 text-[12px] text-neutral-600 underline underline-offset-2 dark:text-neutral-300"
            >
              Abrir el PDF <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            </a>
          </object>
        ) : inline ? (
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            title="Ampliar"
            className="flex h-full w-full cursor-zoom-in items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shownUrl}
              alt={isPayment ? "Comprobante" : "Título profesional"}
              className="max-h-[55vh] w-auto max-w-full object-contain"
            />
          </button>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shownUrl}
            alt={isPayment ? "Comprobante" : "Título profesional"}
            className="max-h-[62vh] w-auto max-w-full object-contain"
          />
        )}
      </div>

      {images && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setImgIdx((i) => (i - 1 + images.length) % images.length)}
            aria-label="Imagen anterior"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setImgIdx(i)}
                aria-label={`Imagen ${i + 1} de ${images.length}`}
                aria-current={i === imgIdx}
                className={`relative h-11 w-9 shrink-0 overflow-hidden rounded-lg border bg-neutral-50 transition dark:bg-neutral-900/40 ${
                  i === imgIdx
                    ? "border-neutral-900 dark:border-neutral-50"
                    : "border-neutral-200 opacity-70 hover:opacity-100 dark:border-neutral-800"
                }`}
              >
                {img.url && img.fileType !== "application/pdf" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-neutral-400 dark:text-neutral-500">
                    <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {Math.min(imgIdx, images.length - 1) + 1}/{images.length}
          </span>
          <button
            type="button"
            onClick={() => setImgIdx((i) => (i + 1) % images.length)}
            aria-label="Imagen siguiente"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      </>}

      <div className={`flex flex-wrap items-center gap-2 ${actionsOnly ? "justify-end" : "mt-4 justify-between"}`}>
        {!actionsOnly && (shownUrl && inline ? (
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Ampliar
          </button>
        ) : shownUrl ? (
          <a
            href={shownUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
            Abrir en otra pestaña
          </a>
        ) : (
          <span />
        ))}

        {canAct &&
          (confirm === "reject" ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-300">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500 dark:text-red-400" strokeWidth={1.75} />
                {isPayment ? `Rechazar este comprobante${groupSuffix}?` : "Rechazar este título?"}
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
          ) : confirm === "approve" ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-[12px] text-neutral-600 dark:text-neutral-300">
                {isPayment ? `Aprobar este comprobante${groupSuffix}?` : "Validar este título?"}
              </span>
              <button
                onClick={() => setConfirm(null)}
                disabled={Boolean(busy)}
                className="rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancelar
              </button>
              <button
                autoFocus
                onClick={() => void act("approve")}
                disabled={Boolean(busy)}
                className="btn-gold flex items-center gap-1.5"
              >
                {busy === "approve" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {isPayment ? "Sí, aprobar" : "Sí, validar"}
              </button>
            </div>
          ) : confirm === "force" ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
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
                {isPayment ? file.status === "awaiting_title" && actionsOnly ? "Forzar aprobación" : "Aprobar" : "Validar título"}
              </button>
            </div>
          ))}
      </div>
      {viewerOpen && (
        <MediaViewerModal
          url={shownUrl}
          fileType={shown.fileType}
          title={isPayment ? "Comprobante" : file.titleName ?? "Título profesional"}
          subtitle={status.text}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}

export function FileReviewModal({
  file,
  onClose,
  onDone,
  intent,
}: {
  file: ContactFile;
  intent?: FileReviewIntent;
  onClose: () => void;
  /** Después de aprobar o rechazar: refrescar la ficha. */
  onDone: () => void;
}) {
  const [state, setState] = useState({ busy: false, confirming: false });

  // Mismo contenedor que el visor de adjuntos del chat (ViewerModal): X en la
  // esquina, Esc y click afuera. Con una confirmación abierta, Esc la cancela
  // (lo maneja el panel); con una acción en curso no se cierra.
  return (
    <ViewerModal
      onClose={onClose}
      ariaLabel={file.kind === "comprobante" ? "Comprobante" : "Título profesional"}
      busy={state.busy}
      escDisabled={state.confirming}
    >
      <FileReviewPanel
        file={file}
        variant="modal"
        intent={intent}
        onStateChange={setState}
        onDone={() => {
          onDone();
          onClose();
        }}
      />
    </ViewerModal>
  );
}
