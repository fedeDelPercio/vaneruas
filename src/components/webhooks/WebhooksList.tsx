"use client";

import toast from "react-hot-toast";
import { X, Power } from "lucide-react";
import type { OutboundWebhook } from "@/lib/supabase/types";

// Lista de webhooks salientes con acciones (activar/desactivar, borrar).

export function WebhooksList({
  webhooks,
  onChanged,
}: {
  webhooks: OutboundWebhook[];
  onChanged: () => void;
}) {
  async function toggleActive(webhook: OutboundWebhook) {
    const res = await fetch(`/api/outbound-webhooks/${webhook.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !webhook.active }),
    });
    if (!res.ok) toast.error("No se pudo actualizar");
    onChanged();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/outbound-webhooks/${id}`, { method: "DELETE" });
    if (!res.ok) toast.error("No se pudo borrar");
    onChanged();
  }

  if (webhooks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-[12px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
        No hay webhooks salientes configurados.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead className="bg-neutral-50/60 text-left font-mono text-[10.5px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-500">
          <tr>
            <th className="px-3 py-2 font-medium">Nombre</th>
            <th className="px-3 py-2 font-medium">URL</th>
            <th className="px-3 py-2 font-medium">Eventos</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {webhooks.map((w) => (
            <tr key={w.id} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="px-3 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                {w.name}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2 font-mono text-[11.5px] text-neutral-500 dark:text-neutral-400">
                {w.url}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {w.events.map((e) => (
                    <span
                      key={e}
                      className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${
                    w.active
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}
                >
                  {w.active ? "activo" : "inactivo"}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => toggleActive(w)}
                    className="rounded-md p-1 text-neutral-400 transition hover:text-neutral-700 dark:hover:text-neutral-200"
                    title={w.active ? "Desactivar" : "Activar"}
                  >
                    <Power className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    onClick={() => remove(w.id)}
                    className="rounded-md p-1 text-neutral-400 transition hover:text-rose-500 dark:hover:text-rose-400"
                    title="Borrar"
                    aria-label={`Borrar webhook ${w.name}`}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
