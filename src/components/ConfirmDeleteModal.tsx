"use client";

import { useEffect } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

// Modal de confirmacion para acciones destructivas (ej: borrar una
// conversacion). El consumidor maneja el async; este componente solo gestiona
// el chrome, el estado de "loading" y el ESC/click-afuera.

export function ConfirmDeleteModal({
  title,
  description,
  confirmLabel = "Borrar",
  loading = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // ESC cierra el modal (salvo durante el delete en curso).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, loading]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-5 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400"
            strokeWidth={1.75}
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
              {title}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
