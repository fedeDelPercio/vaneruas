"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileText, X } from "lucide-react";

// Visor modal único del panel para archivos: adjuntos del chat, miniaturas de
// la ficha del contacto y el archivo de /revision. Uno solo para todo, con o
// sin botones Aprobar / Rechazar (FileReviewModal lo usa como contenedor).
//
// Comportamiento:
//   - Centrado sobre la página (portal a <body>, así no lo afecta ningún
//     contenedor con transform u overflow).
//   - Se cierra con la X de la esquina, con Esc y con click afuera.
//   - Cerrar no navega ni remonta nada: el modal es estado local de quien lo
//     abre. La conversación, los filtros y el scroll del chat y de la lista
//     quedan como estaban. El foco vuelve al elemento que lo abrió sin mover
//     el scroll (preventScroll).

export function ViewerModal({
  onClose,
  ariaLabel,
  busy = false,
  escDisabled = false,
  size = "lg",
  children,
}: {
  onClose: () => void;
  ariaLabel: string;
  /** Acción en curso: no se puede cerrar (ni X, ni Esc, ni click afuera). */
  busy?: boolean;
  /** Esc lo maneja el contenido (p. ej. cancela una confirmación abierta). */
  escDisabled?: boolean;
  /** "lg": archivo con datos y botones; "xl": solo el archivo, más grande. */
  size?: "lg" | "xl";
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Foco adentro al abrir; al cerrar vuelve a quien lo abrió, sin scrollear.
  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      previous?.focus?.({ preventScroll: true });
    };
  }, [mounted]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || busy || escDisabled) return;
      e.stopPropagation();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, escDisabled]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-900/50 p-4 backdrop-blur-sm"
      onClick={busy ? undefined : () => onCloseRef.current()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`glass relative flex max-h-[92vh] w-full flex-col rounded-xl border border-neutral-200 p-5 shadow-soft outline-none dark:border-neutral-800 dark:shadow-soft-dark ${
          size === "xl" ? "max-w-4xl" : "max-w-2xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          disabled={busy}
          aria-label="Cerrar"
          title="Cerrar"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function isPdfType(type: string | null | undefined): boolean {
  return type === "application/pdf";
}

/** Imagen si el tipo lo dice; sin tipo (adjuntos viejos) se asume imagen. */
export function isImageType(type: string | null | undefined): boolean {
  return !type || type.startsWith("image/");
}

/** Solo el archivo (imagen o PDF), sin acciones: adjuntos del chat y /revision. */
export function MediaViewerModal({
  url,
  fileType,
  title,
  subtitle,
  onClose,
}: {
  url: string | null;
  fileType: string | null;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
}) {
  const pdf = isPdfType(fileType);
  const image = !pdf && isImageType(fileType);
  return (
    <ViewerModal onClose={onClose} ariaLabel={title} size="xl">
      <div className="pr-10">
        <h2 className="flex items-center gap-2 text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          <FileText className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
          <span className="truncate">{title}</span>
        </h2>
        {subtitle && (
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400">{subtitle}</p>
        )}
      </div>
      <div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
        {!url ? (
          <p className="py-16 text-[12px] text-neutral-500">No se pudo cargar el archivo</p>
        ) : pdf ? (
          <object data={url} type="application/pdf" className="h-[75vh] w-full">
            <p className="py-16 text-center text-[12px] text-neutral-500">
              Este navegador no muestra el PDF acá. Abrilo con el link de abajo
            </p>
          </object>
        ) : image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={title} className="max-h-[75vh] w-auto max-w-full object-contain" />
        ) : (
          <p className="py-16 text-[12px] text-neutral-500">Vista previa no disponible para este archivo</p>
        )}
      </div>
      {url && (
        <div className="mt-4 flex justify-start">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
            Abrir en otra pestaña
          </a>
        </div>
      )}
    </ViewerModal>
  );
}
