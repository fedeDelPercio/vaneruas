"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Plus } from "lucide-react";

// Formulario para dar de alta un webhook saliente.

const EVENTS = [
  "message.received",
  "agent.responded",
  "agent.escalated",
  "agent.failed",
] as const;

export function WebhookForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleEvent(ev: string) {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev],
    );
  }

  async function submit() {
    if (!name.trim() || !url.trim() || events.length === 0) {
      toast.error("Completá nombre, URL y al menos un evento");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/outbound-webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          events,
          secret: secret.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo crear el webhook");
        return;
      }
      toast.success("Webhook creado");
      setName("");
      setUrl("");
      setEvents([]);
      setSecret("");
      onCreated();
    } catch {
      toast.error("Error de red");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600";

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-[13px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
        Nuevo webhook saliente
      </h3>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          className={inputClass}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (URL destino)"
          className={inputClass}
        />
      </div>
      <input
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="Secret para firma HMAC (opcional)"
        className={`mt-2 w-full ${inputClass}`}
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {EVENTS.map((ev) => (
          <button
            key={ev}
            onClick={() => toggleEvent(ev)}
            className={`rounded-md border px-2 py-1 font-mono text-[11px] transition ${
              events.includes(ev)
                ? "border-neutral-900 bg-neutral-900 font-medium text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-950"
                : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
            }`}
          >
            {ev}
          </button>
        ))}
      </div>
      <button
        onClick={submit}
        disabled={saving}
        className="mt-4 flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-50 dark:text-neutral-950 dark:hover:bg-neutral-200"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        Crear webhook
      </button>
    </div>
  );
}
