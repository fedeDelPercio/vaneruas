"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Loader2, X } from "lucide-react";
import { useProfile } from "./ProfileProvider";
import { DateTimeField } from "./DateTimeField";

// Modal para crear una conversación de prueba.
// Además del nombre del cliente simulado, permite definir:
// - Día y hora "simulado": para probar dentro/fuera de horario sin esperar.
// - Cliente registrado: simula que el contacto ya viene del CRM (Kommo), el
//   agente lo trata como cliente existente y deriva al equipo.

// Devuelve "YYYY-MM-DDTHH:MM" en hora local (formato que espera datetime-local).
function nowLocalString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convierte "YYYY-MM-DDTHH:MM" (hora local) a ISO con offset para mandar al
// backend. Devuelve null si el valor está vacío o no es válido.
function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function NewConversationModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const { profile } = useProfile();
  const [name, setName] = useState("");
  const [simulatedAt, setSimulatedAt] = useState(nowLocalString());
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);
  const [saving, setSaving] = useState(false);

  async function create() {
    const displayName = name.trim();
    if (!displayName) {
      toast.error("Ingresá un nombre para el cliente simulado");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          created_by: profile?.id ?? null,
          simulated_timestamp: localToIso(simulatedAt),
          is_existing_customer: isExistingCustomer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo crear la conversación");
        return;
      }
      onCreated(data.conversation.id);
    } catch {
      toast.error("Error de red");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm glass rounded-xl border border-neutral-200 p-5 shadow-soft dark:border-neutral-800 dark:shadow-soft-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
              Nueva conversación
            </h2>
            <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-500">
              Cada conversación simula un cliente distinto
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 transition hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Nombre */}
        <label className="mt-4 block text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300">
          Nombre del cliente simulado
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder='Ej: "Juan, busca inodoro inteligente"'
          className="mt-1.5 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600"
        />

        {/* Día y hora simulados (popover propio, no datetime-local nativo) */}
        <div className="mt-3">
          <DateTimeField
            value={simulatedAt}
            onChange={setSimulatedAt}
            label="Día y hora del mensaje"
            helpText="El agente lo usa para decidir saludo y si está dentro o fuera de horario"
          />
        </div>

        {/* Cliente existente */}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-md border border-neutral-200 bg-neutral-50/40 px-3 py-2.5 transition hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700">
          <input
            type="checkbox"
            checked={isExistingCustomer}
            onChange={(e) => setIsExistingCustomer(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-neutral-300 bg-white text-neutral-900 transition focus:ring-1 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-neutral-700"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
              Cliente ya registrado
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-neutral-500 dark:text-neutral-500">
              Simula que el contacto ya existe en Kommo. El agente deriva
              directo al equipo en lugar de iniciar el flow comercial
            </span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            onClick={create}
            disabled={saving}
            className="flex items-center gap-1.5 btn-gold"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}
