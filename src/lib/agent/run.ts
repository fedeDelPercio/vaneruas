import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { dispatchEvent } from "@/lib/webhooks/dispatcher";
import { sendTeamNotificationAlert } from "@/lib/email/sender";
import { runOrchestrator } from "./orchestrator";
import { evaluateResponse } from "./evaluator";
import { loadActiveEventsBlock } from "./events-kb";
import { getTimeContext } from "./business-hours";
import type {
  AgentRunInput,
  AgentRunResult,
  NotificationCategory,
  OrchestratorResult,
  RunContext,
  TraceStatus,
} from "./types";
import type { Json } from "@/lib/supabase/types";

// ===========================================================================
// runAgent — entry point del sistema agéntico.
//
// Orquesta el loop EXTERNO: corre el orquestador, lo valida con el evaluator
// y reintenta con feedback hasta MAX_ITERATIONS. Si el orquestador notifica
// al equipo (tool notify_team) o si no se logra una respuesta validada, se
// registra una notificación y la conversación queda en manos de un humano.
//
// No inserta nada en `messages`: de eso se encarga el worker de jobs.
// ===========================================================================

// Cierre de fallback. Nunca dejamos al cliente sin respuesta cuando la
// conversación se deriva: si el orquestador derivó sin generar texto (no
// debería pasar con el prompt actual, que exige cierre siempre) o si se
// agotaron las iteraciones del evaluator, igual le confirmamos que Santino
// lo va a contactar, con el timing ya resuelto (por la tarde / mañana / el
// lunes). Tono positivo de cierre, no de "no pude resolver".
function handoffFallbackNotice(followUpTiming: string): string {
  return (
    "Buenísimo. Nuestro equipo se va a estar contactando con vos " +
    `${followUpTiming} para ayudarte con más detalle`
  );
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const supabase = getSupabaseServerClient();
  const maxIterations = serverEnv().AGENT_MAX_ITERATIONS;

  // 1. Crear el trace en estado 'running'.
  const { data: trace, error: traceErr } = await supabase
    .from("agent_traces")
    .insert({
      conversation_id: input.conversationId,
      user_message_id: input.userMessageId,
      status: "running",
      provider: "anthropic",
    })
    .select("id")
    .single();

  if (traceErr || !trace) {
    throw new Error(`No se pudo crear el trace: ${traceErr?.message ?? "desconocido"}`);
  }
  const traceId = trace.id;

  const ctx: RunContext = {
    traceId,
    conversationId: input.conversationId,
    iteration: 0,
    stepOrder: 0,
    notification: { notified: false, category: null, reason: null, summary: null },
  };

  // Leer contexto adicional de la conversación: si es de prueba puede tener
  // un timestamp simulado (para probar fuera de horario sin esperar) y/o un
  // flag de "cliente ya registrado". En producción (source=whatsapp), el flag
  // is_existing_customer lo trae la integración con Kommo (pendiente).
  const { data: conv } = await supabase
    .from("conversations")
    .select("source, simulated_timestamp, is_existing_customer")
    .eq("id", input.conversationId)
    .maybeSingle();

  const simulatedNow =
    conv?.source === "test" && conv.simulated_timestamp
      ? new Date(conv.simulated_timestamp)
      : new Date();
  const isExistingCustomer = conv?.is_existing_customer ?? false;

  // Contexto compartido por todas las iteraciones.
  const timeContext = getTimeContext(simulatedNow);
  const customerMessageCount =
    input.history.filter((m) => m.role === "user").length + 1;

  // Si la conversación ya fue derivada en un turno anterior, se lo avisamos
  // al orquestador: las notificaciones son internas (no están en el
  // historial), así que sin esto el modelo no sabe que ya derivó y vuelve a
  // hacerlo en cada turno (repitiendo "Santino te va a llamar" ante un
  // simple "gracias"). Tomamos la notificación más reciente como contexto.
  const { data: priorNotif } = await supabase
    .from("agent_notifications")
    .select("category")
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorEscalation = priorNotif?.category ?? null;

  // Catálogo de eventos en vivo (tabla `events`). Se lee una sola vez por
  // corrida y se reusa en todas las iteraciones del evaluator, para no pegarle
  // a la DB en cada reintento. Si no hay eventos comunicables, queda "" y no
  // agrega nada al prompt.
  const eventsBlock = await loadActiveEventsBlock();

  let totalInput = 0;
  let totalOutput = 0;
  let totalLatency = 0;
  let evaluatorFeedback: string | null = null;
  let iterationsRun = 0;

  // 2. Loop de reintentos con el evaluator.
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    ctx.iteration = iteration;
    iterationsRun = iteration;

    let orch: OrchestratorResult;
    try {
      orch = await runOrchestrator({
        ctx,
        userMessage: input.userMessage,
        history: input.history,
        evaluatorFeedback,
        timeContext,
        customerMessageCount,
        isExistingCustomer,
        priorEscalation,
        eventsBlock,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "error desconocido";
      // Falla dura del orquestador (ej. error de API / límite de uso). NUNCA
      // le mandamos un mensaje de disculpa al cliente: notificamos al equipo
      // para que un humano tome la conversación y NO respondemos nada. El
      // cliente no se entera de la falla técnica; el equipo sí.
      const escalationIsNew = await recordNotification({
        traceId,
        conversationId: input.conversationId,
        category: "falla_tecnica",
        reason,
        summary:
          `El agente no pudo procesar el mensaje del cliente ("${input.userMessage}") ` +
          `por un error técnico: ${reason}. Requiere respuesta manual de un asesor.`,
      });
      await finalizeTrace(traceId, {
        status: "failed",
        iterations: iterationsRun,
        totalInput,
        totalOutput,
        totalLatency,
        evaluatorPassed: null,
        escalationReason: reason,
      });
      await dispatchEvent("agent.failed", {
        conversationId: input.conversationId,
        traceId,
        error: reason,
      });
      // assistantMessage vacío: el worker no inserta ninguna burbuja para el
      // cliente. escalationReason = la categoría (no el error crudo) para que
      // el cartel del panel diga "Falla técnica" y no filtre el detalle.
      return {
        traceId,
        assistantMessage: "",
        status: "failed",
        escalationReason: "falla_tecnica",
        escalationIsNew,
      };
    }

    totalInput += orch.inputTokens;
    totalOutput += orch.outputTokens;
    totalLatency += orch.latencyMs;
    await logOrchestratorStep(ctx, orch);

    // El orquestador notificó al equipo: handoff, la conversación se congela.
    if (orch.notification.notified) {
      const category = orch.notification.category ?? "fuera_de_conocimiento";
      const escalationIsNew = await recordNotification({
        traceId,
        conversationId: input.conversationId,
        category,
        reason: orch.notification.reason,
        summary: orch.notification.summary,
      });
      await finalizeTrace(traceId, {
        status: "escalated",
        iterations: iterationsRun,
        totalInput,
        totalOutput,
        totalLatency,
        evaluatorPassed: null,
        escalationReason: category,
      });
      await dispatchEvent("agent.escalated", {
        conversationId: input.conversationId,
        traceId,
        category,
        reason: orch.notification.reason,
        summary: orch.notification.summary,
      });
      // Derivación: si el orquestador generó un texto junto con el
      // notify_team (caso típico: cierre de servicio técnico con el
      // teléfono, o cierre de interes_compra anunciando que Santino
      // contacta), se lo mandamos al cliente. Si no generó texto
      // (escalation silenciosa, ej. cliente_existente sin contexto
      // adicional o arquitecto_desarrollador), NO mandamos nada y la
      // notificación interna alcanza.
      const handoffText = orch.responseText?.trim() ?? "";
      return {
        traceId,
        assistantMessage:
          handoffText || handoffFallbackNotice(timeContext.followUpTiming),
        status: "escalated",
        escalationReason: category,
        escalationIsNew,
      };
    }

    // Validar con el evaluator (portón de pre-envío / anti-alucinación).
    const evaluation = await evaluateResponse({
      ctx,
      userMessage: input.userMessage,
      assistantResponse: orch.responseText,
      history: input.history,
      eventsBlock,
    });

    if (evaluation.pass) {
      await finalizeTrace(traceId, {
        status: "completed",
        iterations: iterationsRun,
        totalInput,
        totalOutput,
        totalLatency,
        evaluatorPassed: true,
        escalationReason: null,
      });
      await dispatchEvent("agent.responded", {
        conversationId: input.conversationId,
        traceId,
        message: orch.responseText,
      });
      return { traceId, assistantMessage: orch.responseText, status: "completed" };
    }

    // No pasó la validación: guardar feedback y reintentar.
    evaluatorFeedback = evaluation.suggestion;
  }

  // 3. Se agotaron las iteraciones sin una respuesta validada: la IA no pudo
  //    responder de forma confiable -> notificar al equipo y CORTAR (no
  //    seguir gastando tokens ni mandar nada al lead). El summary incluye
  //    el ultimo feedback del evaluator para que el admin entienda que
  //    seguia fallando.
  const category: NotificationCategory = "fuera_de_conocimiento";
  // Reason: tecnico, va al log/agent_notifications (no a la notificacion humana).
  const reason = `Agente bloqueado: el evaluator rechazo ${iterationsRun} veces seguidas.`;
  // Summary: lo lee la persona que toma la conversacion en el panel y en el
  // email. Sin jerga interna ("evaluator", "iteraciones", "feedback"): solo
  // que la IA no pudo responder y que requiere respuesta humana directa.
  const summary = [
    `Consulta del cliente: "${input.userMessage}"`,
    "",
    "El agente no pudo responder esta consulta con la base de conocimiento " +
      "actual y la conversación necesita una respuesta directa del equipo.",
  ].join("\n");
  const escalationIsNew = await recordNotification({
    traceId,
    conversationId: input.conversationId,
    category,
    reason,
    summary,
  });
  await finalizeTrace(traceId, {
    status: "escalated",
    iterations: iterationsRun,
    totalInput,
    totalOutput,
    totalLatency,
    evaluatorPassed: false,
    escalationReason: category,
  });
  await dispatchEvent("agent.escalated", {
    conversationId: input.conversationId,
    traceId,
    category,
    reason: "max_iterations_sin_respuesta_validada",
  });
  return {
    traceId,
    assistantMessage: handoffFallbackNotice(timeContext.followUpTiming),
    status: "escalated",
    escalationReason: category,
    escalationIsNew,
  };
}

// --- helpers ---------------------------------------------------------------

/**
 * Registra una notificación al equipo de ventas. Devuelve `true` si insertó
 * una notificación nueva, `false` si ya existía una de la misma categoría
 * para esta conversación (dedupe: evita avisar/emailar dos veces por el
 * mismo motivo cuando el agente sigue conversando tras derivar).
 */
async function recordNotification(args: {
  traceId: string;
  conversationId: string;
  category: NotificationCategory;
  reason: string | null;
  summary: string | null;
}): Promise<boolean> {
  try {
    const supabase = getSupabaseServerClient();
    const { count } = await supabase
      .from("agent_notifications")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", args.conversationId)
      .eq("category", args.category);
    if ((count ?? 0) > 0) return false;

    await supabase.from("agent_notifications").insert({
      conversation_id: args.conversationId,
      trace_id: args.traceId,
      category: args.category,
      reason: args.reason,
      summary: args.summary,
    });

    // Email al equipo. Solo se manda la PRIMERA vez por categoría (el
    // dedupe de arriba corta los siguientes para la misma conversación).
    // Si las env vars de Gmail no están configuradas, el sender hace skip
    // silencioso y no bloquea el flow del agente.
    const { data: conv } = await supabase
      .from("conversations")
      .select("source")
      .eq("id", args.conversationId)
      .maybeSingle();
    await sendTeamNotificationAlert({
      category: args.category,
      reason: args.reason,
      summary: args.summary,
      conversationId: args.conversationId,
      conversationSource: conv?.source ?? null,
    });

    return true;
  } catch (err) {
    console.error("[run] no se pudo registrar la notificación:", err);
    return false;
  }
}

/** Registra el step del orquestador (con sus tokens) en el trace. */
async function logOrchestratorStep(
  ctx: RunContext,
  orch: OrchestratorResult,
): Promise<void> {
  try {
    await getSupabaseServerClient()
      .from("agent_trace_steps")
      .insert({
        trace_id: ctx.traceId,
        step_order: ctx.stepOrder++,
        step_type: "orchestrator",
        step_name: "orchestrator",
        iteration: ctx.iteration,
        model: orch.model,
        provider: "anthropic",
        input: null,
        output: {
          responseText: orch.responseText,
          notified: orch.notification.notified,
        } as Json,
        input_tokens: orch.inputTokens,
        output_tokens: orch.outputTokens,
        latency_ms: orch.latencyMs,
        error: null,
      });
  } catch (err) {
    console.error("[run] no se pudo registrar el step del orquestador:", err);
  }
}

/** Cierra el trace con su estado final y las métricas acumuladas. */
async function finalizeTrace(
  traceId: string,
  data: {
    status: TraceStatus;
    iterations: number;
    totalInput: number;
    totalOutput: number;
    totalLatency: number;
    evaluatorPassed: boolean | null;
    escalationReason: string | null;
  },
): Promise<void> {
  await getSupabaseServerClient()
    .from("agent_traces")
    .update({
      status: data.status,
      iterations: data.iterations,
      total_input_tokens: data.totalInput,
      total_output_tokens: data.totalOutput,
      total_latency_ms: data.totalLatency,
      evaluator_passed: data.evaluatorPassed,
      escalation_reason: data.escalationReason,
    })
    .eq("id", traceId);
}
