"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { OutboundWebhookDelivery } from "@/lib/supabase/types";

// Tabla de las últimas entregas de webhooks salientes (debugging).

export function DeliveriesTable() {
  const [deliveries, setDeliveries] = useState<OutboundWebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await getSupabaseBrowserClient()
      .from("outbound_webhook_deliveries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setDeliveries(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function statusColor(status: number | null): string {
    if (status === null)
      return "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
    if (status >= 200 && status < 300)
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
    return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          Últimas entregas
        </h3>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-500 transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          <RefreshCw
            className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          Refrescar
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {deliveries.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-neutral-500 dark:text-neutral-500">
            Sin entregas registradas todavía.
          </p>
        ) : (
          <table className="w-full min-w-[520px] text-[13px]">
            <thead className="bg-neutral-50/60 text-left font-mono text-[10.5px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Evento</th>
                <th className="px-3 py-2 font-medium">HTTP</th>
                <th className="px-3 py-2 font-medium">Respuesta</th>
                <th className="px-3 py-2 font-medium">Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 font-mono text-[11.5px] text-neutral-700 dark:text-neutral-300">
                    {d.event}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-medium ${statusColor(d.response_status)}`}
                    >
                      {d.response_status ?? "error"}
                    </span>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-[12px] text-neutral-500 dark:text-neutral-500">
                    {d.response_body ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
                    {formatDistanceToNow(new Date(d.created_at), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
