"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Cog, Loader2 } from "lucide-react";
import { clientEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Panel flotante de debugging (solo dev). En local no corre el cron de Vercel,
// asi que ofrece un boton para disparar el worker y muestra los jobs en cola.

export function JobsDebugPanel() {
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    const { count } = await getSupabaseBrowserClient()
      .from("agent_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "processing"]);
    setCount(count ?? 0);
  }, []);

  useEffect(() => {
    void refresh();
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("jobs-debug")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_jobs",
          filter: `client_slug=eq.${clientEnv.NEXT_PUBLIC_CLIENT_SLUG}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  async function processNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/jobs/process", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falló el worker");
        return;
      }
      toast.success(`Worker: ${data.processed ?? 0} procesado(s) de ${data.claimed ?? 0}`);
    } catch {
      toast.error("Error de red al disparar el worker");
    } finally {
      setRunning(false);
      void refresh();
    }
  }

  return (
    <div className="fixed bottom-[5.5rem] right-3 z-20 flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 py-1 pl-3 pr-1 shadow-lg backdrop-blur md:right-4 dark:border-neutral-700 dark:bg-neutral-800/95">
      <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        <Cog className="h-3.5 w-3.5" />
        {count} en cola
      </span>
      <button
        onClick={processNow}
        disabled={running}
        className="flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-violet-700 disabled:opacity-60"
      >
        {running && <Loader2 className="h-3 w-3 animate-spin" />}
        Procesar
      </button>
    </div>
  );
}
