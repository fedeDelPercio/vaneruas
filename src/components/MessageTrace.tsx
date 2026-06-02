"use client";

import { useEffect, useState } from "react";
import { Loader2, ChevronRight, AlertTriangle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AgentTrace, AgentTraceStep } from "@/lib/supabase/types";

// Vista avanzada de un mensaje del agente: muestra el trace agentico completo
// (steps del orquestador, subagentes, tools y evaluator) con sus metricas.

const STATUS_STYLE: Record<string, string> = {
  completed:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  escalated:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  running:
    "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

// Tipos de step: paleta monocromática con una variante (evaluator) que sí
// merece color por ser semánticamente "el revisor". El resto se distingue
// por la tipografía mono uppercase, no por color saturado.
const STEP_STYLE: Record<string, string> = {
  orchestrator:
    "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  subagent:
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800/70 dark:text-neutral-300",
  tool:
    "bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400",
  evaluator:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
};

export function MessageTrace({ traceId }: { traceId: string }) {
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const [steps, setSteps] = useState<AgentTraceStep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    void (async () => {
      const [traceRes, stepsRes] = await Promise.all([
        supabase.from("agent_traces").select("*").eq("id", traceId).maybeSingle(),
        supabase
          .from("agent_trace_steps")
          .select("*")
          .eq("trace_id", traceId)
          .order("step_order", { ascending: true }),
      ]);
      if (!active) return;
      setTrace(traceRes.data);
      setSteps(stepsRes.data ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [traceId]);

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando trace…
      </div>
    );
  }
  if (!trace) {
    return (
      <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
        Trace no disponible.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      {/* Resumen */}
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
        <span
          className={`rounded-full px-2 py-0.5 font-medium uppercase tracking-wide ${
            STATUS_STYLE[trace.status] ?? STATUS_STYLE.running
          }`}
        >
          {trace.status}
        </span>
        <span>
          {trace.iterations} iteración{trace.iterations === 1 ? "" : "es"}
        </span>
        <span className="text-neutral-300 dark:text-neutral-600">·</span>
        <span>
          {trace.total_input_tokens + trace.total_output_tokens} tokens (
          {trace.total_input_tokens} in / {trace.total_output_tokens} out)
        </span>
        <span className="text-neutral-300 dark:text-neutral-600">·</span>
        <span>{trace.total_latency_ms} ms</span>
        <span className="text-neutral-300 dark:text-neutral-600">·</span>
        <span>provider: {trace.provider}</span>
      </div>

      {/* Banner de escalacion */}
      {trace.status === "escalated" && (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Derivada a un asesor humano.
            {trace.escalation_reason ? ` Motivo: ${trace.escalation_reason}` : ""}
          </span>
        </div>
      )}

      {/* Tabla de steps */}
      <div className="mt-3 space-y-1">
        {steps.length === 0 ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Sin steps registrados.
          </p>
        ) : (
          steps.map((step) => <StepRow key={step.id} step={step} />)
        )}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: AgentTraceStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition ${open ? "rotate-90" : ""}`}
        />
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${
            STEP_STYLE[step.step_type] ?? STEP_STYLE.tool
          }`}
        >
          {step.step_type}
        </span>
        <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">
          {step.step_name}
        </span>
        <span className="text-neutral-400 dark:text-neutral-500">it.{step.iteration}</span>
        <span className="ml-auto flex items-center gap-2 whitespace-nowrap text-neutral-400 dark:text-neutral-500">
          <span className="hidden sm:inline">{step.model}</span>
          <span>
            {step.input_tokens}/{step.output_tokens} tok
          </span>
          <span>{step.latency_ms} ms</span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-neutral-100 p-2 dark:border-neutral-700">
          {step.error && (
            <p className="rounded bg-red-50 p-1.5 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {step.error}
            </p>
          )}
          <JsonBlock label="input" value={step.input} />
          <JsonBlock label="output" value={step.output} />
        </div>
      )}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
        {label}: <span className="italic">vacío</span>
      </p>
    );
  }
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </p>
      <pre className="scroll-thin mt-0.5 max-h-48 overflow-auto rounded bg-neutral-900 p-2 text-[11px] leading-relaxed text-neutral-100 dark:bg-neutral-950">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
