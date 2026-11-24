import { FileText } from "lucide-react";

export function fmtDateTime(iso: string): string {
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
export function fmtTransferDate(transferredAt: string | null, raw: string | null): string | null {
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

/** Conserva la posición del campo cuando la lectura no encontró un valor. */
export function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words text-[13px] ${
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
export function Thumb({
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
        // Carga diferida: "Todos" tiene cientos de tarjetas y bajar todas las
        // imágenes de una dejaba la pantalla trabada medio minuto.
        loading="lazy"
        decoding="async"
        className={`rounded-md border border-neutral-200 object-cover transition hover:opacity-90 dark:border-neutral-800 ${className}`}
      />
    </a>
  );
}

