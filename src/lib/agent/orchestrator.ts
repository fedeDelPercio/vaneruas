import "server-only";

import type { Tool } from "@anthropic-ai/sdk/resources/messages";

import { serverEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { createConversationMessage } from "./llm-call";
import { loadPrompt } from "./prompts";
import {
  NOTIFY_TEAM_TOOL_NAME,
  NOTIFY_TEAM_TOOL_SCHEMA,
  applyNotifyTeam,
  type NotifyTeamArgs,
  REGISTRAR_NOMBRE_TOOL_NAME,
  REGISTRAR_NOMBRE_TOOL_SCHEMA,
  applyRegistrarNombre,
  type RegistrarNombreArgs,
} from "./tools";
import { usageToTotals } from "./hooks/token-tracker";
import { type TimeContext } from "./business-hours";
import { buildSystemPrompt, buildMessages } from "./prompt-builder";
import { sanitizeStyle } from "./sanitize";
import type { HistoryMessage, OrchestratorResult, RunContext } from "./types";

// ===========================================================================
// Orquestador.
//
// Llama UNA vez a `messages.create()` por iteración. La respuesta puede
// contener:
//   - bloques `text` → respuesta para el cliente.
//   - opcionalmente un bloque `tool_use` invocando `notify_team` → señaliza
//     derivación al equipo via RunContext.notification.
//
// El loop externo de reintentos con el evaluator vive en run.ts.
// ===========================================================================

const ORCHESTRATOR_MAX_TOKENS = 2048;

/**
 * Inserta un step en agent_trace_steps para una llamada a tool. No falla la
 * corrida si la inserción tira error.
 */
async function logToolStep(
  ctx: RunContext,
  toolName: string,
  input: Record<string, unknown>,
  output: string,
): Promise<void> {
  try {
    await getSupabaseServerClient()
      .from("agent_trace_steps")
      .insert({
        trace_id: ctx.traceId,
        step_order: ctx.stepOrder++,
        step_type: "tool",
        step_name: toolName,
        iteration: ctx.iteration,
        model: "tool",
        provider: "anthropic",
        input: input as unknown as Json,
        output: { text: output } as Json,
        input_tokens: 0,
        output_tokens: 0,
        latency_ms: 0,
        error: null,
      });
  } catch (err) {
    console.error("[orchestrator] no se pudo registrar el step de tool:", err);
  }
}

/**
 * Corre una iteración del orquestador. Devuelve la respuesta propuesta y las
 * métricas. Lanza si la API devuelve un error duro (run.ts lo captura).
 */
export async function runOrchestrator(params: {
  ctx: RunContext;
  userMessage: string;
  history: HistoryMessage[];
  evaluatorFeedback: string | null;
  timeContext: TimeContext;
  customerMessageCount: number;
  isExistingCustomer: boolean;
  priorEscalation: string | null;
  eventsBlock: string;
  paymentContext: string;
}): Promise<OrchestratorResult> {
  const env = serverEnv();
  const { ctx } = params;
  const model = env.ANTHROPIC_MODEL_ORCHESTRATOR;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), env.AGENT_TIMEOUT_MS);
  const startedAt = Date.now();

  const tools: Tool[] = [NOTIFY_TEAM_TOOL_SCHEMA, REGISTRAR_NOMBRE_TOOL_SCHEMA];

  try {
    const response = await createConversationMessage(
      {
        model,
        max_tokens: ORCHESTRATOR_MAX_TOKENS,
        system: buildSystemPrompt({
          orchestratorPrompt: loadPrompt("orchestrator"),
          knowledgeBase: loadPrompt("knowledge-base"),
          timeContext: params.timeContext,
          customerMessageCount: params.customerMessageCount,
          isExistingCustomer: params.isExistingCustomer,
          priorEscalation: params.priorEscalation,
          eventsBlock: params.eventsBlock,
          paymentContext: params.paymentContext,
        }),
        messages: buildMessages(params),
        tools,
      },
      { signal: abortController.signal },
    );

    // Procesar los bloques de la respuesta: acumular texto + atender tool_use.
    let responseText = "";
    for (const block of response.content) {
      if (block.type === "text") {
        responseText += (responseText ? "\n" : "") + block.text;
      } else if (
        block.type === "tool_use" &&
        block.name === NOTIFY_TEAM_TOOL_NAME
      ) {
        const args = block.input as NotifyTeamArgs;
        applyNotifyTeam(ctx, args);
        await logToolStep(
          ctx,
          NOTIFY_TEAM_TOOL_NAME,
          args as unknown as Record<string, unknown>,
          "Equipo notificado. Conversación derivada a un humano.",
        );
      } else if (
        block.type === "tool_use" &&
        block.name === REGISTRAR_NOMBRE_TOOL_NAME
      ) {
        const args = block.input as RegistrarNombreArgs;
        await applyRegistrarNombre(ctx, args);
        await logToolStep(
          ctx,
          REGISTRAR_NOMBRE_TOOL_NAME,
          args as unknown as Record<string, unknown>,
          "Nombre registrado en el panel y seteado en el contacto de GHL.",
        );
      }
    }

    const totals = usageToTotals(response.usage);

    // Sanitizacion de estilo deterministica (emojis, ¿¡, **bold**, em dash,
    // punto final). Antes esto vivia como criterios bloqueantes del evaluator
    // y causaba falsos positivos (rechazo de respuestas validas -> derivacion
    // al equipo). Ahora se garantiza en codigo; el evaluator solo valida lo
    // que requiere criterio.
    return {
      responseText: sanitizeStyle(responseText.trim()),
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      latencyMs: Date.now() - startedAt,
      // Si respondió el fallback, lo dejamos visible en el trace.
      model: response.provider === "anthropic" ? model : `openrouter:${response.model}`,
      notification: ctx.notification,
    };
  } finally {
    clearTimeout(timeout);
  }
}
