"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import type { CardStep } from "@/lib/payments/card-steps";

const secondary = "rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

export function AccessActions({ step, paymentId, savedError, onFocusEmail, onSaved }: {
  step: CardStep;
  paymentId: string;
  savedError: string | null;
  onFocusEmail?: () => void;
  onSaved: (message?: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"grant" | "mark" | null>(null);
  const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);
  const canMark = step.actions?.includes("mark");
  const needsEmail = step.actions?.includes("email");
  const canGrant = step.actions?.includes("grant");

  async function update(action: "grant" | "mark") {
    const markOnly = action === "mark";
    setBusy(action);
    setResult(null);
    try {
      const response = await fetch(`/api/payments/${paymentId}/grant-access`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(markOnly ? { markOnly: true } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 202 && data.queued) {
        setResult({ text: data.message ?? "El alta quedó en cola de reintento" });
        onSaved();
      } else if (!response.ok || !data.ok) {
        setResult({ text: data.error ?? "No se pudo registrar el acceso al curso", error: true });
      } else {
        const message = markOnly ? "Alta manual registrada"
          : data.alreadyEnrolled ? "Ya estaba inscripta en el curso. El acceso quedó registrado" : "Acceso al curso dado";
        setResult({ text: message });
        onSaved(message);
      }
    } catch {
      setResult({ text: "Error de red al registrar el acceso al curso", error: true });
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  const feedback = (step.status === "done" && result?.error ? null : result)
    ?? (savedError && canGrant ? { text: savedError, error: true } : null);
  return (
    <>
      {canMark && (confirm ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11.5px] text-neutral-600 dark:text-neutral-400">Marcar el acceso como dado sin inscribir en Tiendup?</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" className="btn-gold" disabled={!!busy} onClick={() => void update("mark")}>
              {busy ? "Marcando…" : "Confirmar"}
            </button>
            <button type="button" className={secondary} disabled={!!busy} onClick={() => setConfirm(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {canGrant && (
            <button type="button" className={`${step.status === "current" ? "btn-gold" : secondary} inline-flex items-center gap-1.5`}
              disabled={!!busy} onClick={() => void update("grant")}>
              {busy === "grant" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {busy ? "Dando acceso…" : "Dar acceso al curso"}
            </button>
          )}
          {needsEmail && onFocusEmail && (
            <button type="button" className={`${secondary} underline underline-offset-2`} onClick={onFocusEmail}>Cargar mail</button>
          )}
          {needsEmail && !onFocusEmail && <p className="text-[11.5px] text-neutral-600 dark:text-neutral-400">Cargá el mail en la ficha del contacto</p>}
          <button type="button" className={secondary} disabled={!!busy} onClick={() => setConfirm(true)}>
            Ya le dimos el alta a mano en Tiendup
          </button>
        </div>
      ))}
      {feedback && (
        <p role="status" className={`mt-1 text-[11.5px] ${feedback.error ? "text-red-700 dark:text-red-300" : "text-neutral-600 dark:text-neutral-300"}`}>
          {feedback.text}
        </p>
      )}
    </>
  );
}
