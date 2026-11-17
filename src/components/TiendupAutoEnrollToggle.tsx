"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";

// Interruptor "Alta automática en Tiendup" (Aprobaciones → Falta acceso).
// Prendido: al quedar un pago validado con título OK y correo válido, se
// inscribe solo en Tiendup (misma lógica que "Dar acceso al curso"). Apagado:
// todo queda en Falta acceso para darlo a mano. Mismo patrón que el
// interruptor general del agente (AgentModeToggle): confirmación corta antes
// de prender (impacta a todos los contactos), apagar es directo.
// Optimistic update con rollback si falla. Asesor lo ve en solo lectura.

type Source = "db" | "env" | "default";

interface State {
  enabled: boolean;
  source: Source;
  updatedAt: string | null;
  updatedBy: string | null;
  canEdit: boolean;
  tableMissing?: boolean;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TiendupAutoEnrollToggle() {
  const { profile } = useProfile();
  const profileId = profile?.id ?? null;
  const [state, setState] = useState<State | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) return;
    try {
      const r = await fetch(
        `/api/settings/tiendup-auto-enroll?profileId=${encodeURIComponent(profileId)}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      setState((await r.json()) as State);
    } catch {
      // Informativo: si falla, no rompemos la pestaña.
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(next: boolean) {
    if (!state || !profileId) return;
    const prev = state;
    setConfirming(false);
    setError(null);
    setBusy(true);
    setState({ ...state, enabled: next, source: "db" });
    try {
      const r = await fetch("/api/settings/tiendup-auto-enroll", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next, profileId }),
      });
      const j = (await r.json().catch(() => ({}))) as Partial<State> & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el cambio");
      setState({ ...prev, ...j, canEdit: prev.canEdit } as State);
    } catch (err) {
      setState(prev);
      setError(err instanceof Error ? err.message : "No se pudo guardar el cambio");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const { enabled, canEdit } = state;
  const disabled = !canEdit || busy;

  const meta: string[] = [];
  if (state.source !== "db") meta.push("Según configuración del servidor");
  if (state.source === "db" && state.updatedBy && state.updatedAt) {
    meta.push(`Cambiado por ${state.updatedBy} el ${fmtDate(state.updatedAt)}`);
  } else if (state.source === "db" && state.updatedAt) {
    meta.push(`Cambiado el ${fmtDate(state.updatedAt)}`);
  }
  if (!canEdit) meta.push("Solo lectura");

  return (
    <div className="relative mb-3 rounded-lg border border-neutral-200 px-3.5 py-2.5 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
            Alta automática en Tiendup
          </p>
          {meta.length > 0 && (
            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-500">
              {meta.join(" · ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" strokeWidth={1.75} />
          )}
          <span
            className={`text-[12px] font-medium ${
              enabled ? "text-gold" : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {enabled ? "Prendida" : "Apagada"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Alta automática en Tiendup"
            disabled={disabled}
            onClick={() => (enabled ? void apply(false) : setConfirming(true))}
            title={
              !canEdit
                ? "Solo los perfiles Cliente o Desarrollador pueden cambiarlo"
                : enabled
                  ? "Apagar el alta automática"
                  : "Prender el alta automática"
            }
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
              enabled
                ? "bg-gradient-to-br from-gold to-gold-start hover:shadow-gold"
                : "bg-neutral-200 dark:bg-neutral-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${
                enabled ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}

      {confirming && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setConfirming(false)} />
          <div className="absolute right-0 top-full z-[60] mt-2 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark">
            <p className="text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
              Va a inscribir en Tiendup automáticamente a quien tenga pago y título aprobados y
              correo válido
            </p>
            <div className="mt-3 flex items-center justify-end gap-1">
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancelar
              </button>
              <button onClick={() => void apply(true)} className="flex items-center gap-1.5 btn-gold">
                Prender
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
