"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Interruptor general del agente: enciende o apaga a la IA para TODAS las
// conversaciones de WhatsApp. Cuando está en Humano, el agente no responde
// ninguna conversación y atiende el equipo (útil durante un evento con mucha
// consulta puntual). Pide confirmación porque impacta a todos los contactos.

type Mode = "AI" | "HUMAN";

// `placement="up"`: abre los popovers hacia arriba y a la derecha (abajo del
// menú lateral). `compact`: solo el switch, sin label (menú lateral contraído);
// el estado queda en aria-label y title.
export function AgentModeToggle({
  placement = "down",
  compact = false,
}: { placement?: "down" | "up"; compact?: boolean } = {}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent-mode", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { mode: Mode };
      setMode(j.mode);
    } catch {
      // Informativo: si falla, no rompemos el header.
    } finally {
      setLoading(false);
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
      if (r.ok) {
        const j = (await r.json()) as {
          updated?: number;
          excluded?: number;
          warning?: string | null;
        };
        setMode(next);
        if (j.warning) setResult(j.warning);
        else if (next === "AI" && (j.excluded ?? 0) > 0) {
          setResult(
            `IA activada. ${j.excluded} contacto(s) siguen en atención humana porque están marcados así en GoHighLevel`,
          );
        } else setResult(null);
      }
    } catch {
      // idem
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  // Cargando: el switch se ve deshabilitado y neutro para que no salte el
  // layout. Si la carga falla, no se muestra (como antes).
  if (!mode) {
    if (!loading) return null;
    return (
      <div
        role="status"
        title="Cargando el estado de la IA"
        className={`flex items-center ${compact ? "justify-center p-1.5" : "gap-2 px-2 py-1.5"}`}
      >
        {!compact && (
          <span className="whitespace-nowrap text-[12px] font-medium text-neutral-400 dark:text-neutral-500">IA</span>
        )}
        <span aria-hidden className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-neutral-200 opacity-60 dark:bg-neutral-800">
          <span className="flex h-4 w-4 translate-x-0.5 items-center justify-center rounded-full bg-white dark:bg-neutral-600">
            <Loader2 className="h-2.5 w-2.5 animate-spin text-neutral-400" strokeWidth={2} />
          </span>
        </span>
        <span className="sr-only">Cargando el estado de la IA</span>
      </div>
    );
  }
  const isAI = mode === "AI";
  const next: Mode = isAI ? "HUMAN" : "AI";
  const popoverPos = placement === "up" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2";

  return (
    <div className="relative">
      {result && (
        <div className={`absolute z-[60] w-72 ${popoverPos} rounded-lg border border-neutral-200 bg-white p-3 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark`}>
          <p className="text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
            {result}
          </p>
          <button
            onClick={() => setResult(null)}
            className="mt-2 text-[12px] text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
          >
            Entendido
          </button>
        </div>
      )}
      {/* Switch real (track + thumb). Tocarlo no cambia el modo en el acto:
          abre la confirmación de siempre; aria-checked refleja el estado
          vigente. Sutil a propósito (no tiene que resaltar en el menú):
          prendido = track neutro oscuro (claro en dark), apagado = gris. Sin
          dorado ni glow. */}
      <button
        type="button"
        role="switch"
        aria-checked={isAI}
        aria-label={isAI ? "IA activa" : "IA apagada"}
        aria-busy={busy}
        disabled={busy}
        onClick={() => setConfirming((v) => !v)}
        title={
          isAI
            ? "IA activa. Tocá para pasar todo a atención humana"
            : "IA apagada. Tocá para volver a activarla"
        }
        className={`group flex items-center rounded-lg transition hover:bg-neutral-100 disabled:cursor-wait dark:hover:bg-neutral-900 ${
          compact ? "justify-center p-1.5" : "gap-2 px-2 py-1.5"
        }`}
      >
        {!compact && (
          <span
            className="whitespace-nowrap text-[12px] font-medium text-neutral-600 dark:text-neutral-400"
          >
            {isAI ? "IA activa" : "IA apagada"}
          </span>
        )}
        <span
          aria-hidden
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
            isAI
              ? "bg-neutral-800 dark:bg-neutral-300"
              : "bg-neutral-200 group-hover:bg-neutral-300 dark:bg-neutral-800 dark:group-hover:bg-neutral-700"
          } ${busy ? "opacity-60" : ""}`}
        >
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full transition ${
              isAI
                ? "translate-x-[18px] bg-white dark:bg-neutral-900"
                : "translate-x-0.5 bg-white dark:bg-neutral-500"
            }`}
          >
            {busy && <Loader2 className="h-2.5 w-2.5 animate-spin text-neutral-500" strokeWidth={2} />}
          </span>
        </span>
      </button>

      {confirming && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setConfirming(false)} />
          <div className={`absolute z-[60] w-72 ${popoverPos} rounded-lg border border-neutral-200 bg-white p-3 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark`}>
            <p className="text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
              {isAI
                ? "Apagar la IA en todas las conversaciones. Valentina deja de responder y atiende el equipo"
                : "Activar la IA en todas las conversaciones. Valentina vuelve a responder los mensajes nuevos. Los contactos marcados como humano en GoHighLevel quedan como están"}
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
                {isAI ? "Apagar IA" : "Activar IA"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
