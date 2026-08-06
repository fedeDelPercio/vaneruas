"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, UserRound } from "lucide-react";

// Interruptor general del agente: enciende o apaga a la IA para TODAS las
// conversaciones de WhatsApp. Cuando está en Humano, el agente no responde
// ninguna conversación y atiende el equipo (útil durante un evento con mucha
// consulta puntual). Pide confirmación porque impacta a todos los contactos.

type Mode = "AI" | "HUMAN";

export function AgentModeToggle() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent-mode", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { mode: Mode };
      setMode(j.mode);
    } catch {
      // Informativo: si falla, no rompemos el header.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(next: Mode) {
    setBusy(true);
    try {
      const r = await fetch("/api/agent-mode", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (r.ok) setMode(next);
    } catch {
      // idem
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!mode) return null;
  const isAI = mode === "AI";
  const next: Mode = isAI ? "HUMAN" : "AI";

  return (
    <div className="relative">
      <button
        onClick={() => setConfirming((v) => !v)}
        title={
          isAI
            ? "La IA está respondiendo. Tocá para pasar todo a atención humana"
            : "La IA está pausada. Tocá para volver a activarla"
        }
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition ${
          isAI
            ? "text-ok hover:bg-neutral-100 dark:hover:bg-neutral-900"
            : "text-warn hover:bg-neutral-100 dark:hover:bg-neutral-900"
        }`}
      >
        {isAI ? (
          <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
        ) : (
          <UserRound className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        <span className="hidden sm:inline">{isAI ? "IA activa" : "IA pausada"}</span>
      </button>

      {confirming && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setConfirming(false)} />
          <div className="absolute right-0 z-[60] mt-2 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark">
            <p className="text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
              {isAI
                ? "Pausar la IA en todas las conversaciones. Valentina deja de responder y atiende el equipo"
                : "Activar la IA en todas las conversaciones. Valentina vuelve a responder los mensajes nuevos"}
            </p>
            <div className="mt-3 flex items-center justify-end gap-1">
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => void apply(next)}
                disabled={busy}
                className="flex items-center gap-1.5 btn-gold"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
                {isAI ? "Pausar IA" : "Activar IA"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
