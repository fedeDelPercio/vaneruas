import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { runAgent } from "@/lib/agent/run";
import { testProvider } from "@/lib/providers/test-provider";
import { isAllowedComprobanteType } from "@/lib/payments/storage";
import { handleAttachmentIntake } from "@/lib/titles/handle";
import type { HistoryMessage } from "@/lib/agent/types";
import type { AgentJob } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
// El worker puede tardar: corre el agente completo. Vercel necesita el límite.
export const maxDuration = 300;

// ===========================================================================
// POST /api/jobs/process
//
// Worker de jobs. Lo dispara el cron de Vercel (cada minuto) o el auto-trigger
// del webhook entrante. Reclama hasta 5 jobs pending de forma atómica y corre
// el agente para cada uno. Protegido por CRON_SECRET (en dev se permite sin
// secret para el botón "Procesar ahora").
// ===========================================================================

const BATCH_SIZE = 5;
// Maximo de mensajes previos que se le pasan al orquestador como history.
// Mas history = mas contexto pero tambien mas tokens. 10 cubre conversaciones
// realistas (saludo + 4-5 idas y vueltas de descubrimiento) sin inflar el
// prompt en conversaciones muy largas.
const HISTORY_LIMIT = 10;

// Etiquetas legibles para las categorías comunes (cada cliente puede sumar
// las suyas en su rama). Cualquier otra categoría se humaniza automáticamente
// con `humanizeCategory()`.
const COMMON_CATEGORY_LABEL: Record<string, string> = {
  interes_compra: "Interés de compra",
  cliente_existente: "Cliente existente",
  fuera_de_conocimiento: "Consulta fuera de la base de conocimiento",
  escalado_manual: "Escalado manual",
  falla_tecnica: "Falla técnica",
};

/** Convierte una categoría snake_case en un texto legible para el cartel. */
function humanizeCategory(category: string): string {
  const known = COMMON_CATEGORY_LABEL[category];
  if (known) return known;
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = serverEnv().CRON_SECRET;
  return (
    req.headers.get("x-cron-secret") === secret ||
    req.headers.get("authorization") === `Bearer ${secret}`
  );
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const { data: jobs, error } = await supabase.rpc("claim_agent_jobs", {
    p_limit: BATCH_SIZE,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!jobs || jobs.length === 0) return NextResponse.json({ processed: 0 });

  let processed = 0;
  let failed = 0;
  // Secuencial: evita levantar varias sesiones del Agent SDK en paralelo.
  for (const job of jobs) {
    try {
      await processJob(job);
      processed++;
    } catch (err) {
      await handleJobFailure(job, err);
      failed++;
    }
  }

  return NextResponse.json({ claimed: jobs.length, processed, failed });
}

/** Procesa un job: corre el agente y persiste la respuesta. */
async function processJob(job: AgentJob): Promise<void> {
  const supabase = getSupabaseServerClient();

  // Comprobante de pago: si el mensaje trae una imagen/PDF adjunto, corre el
  // flujo de captura de pago (lee con vision, registra en payment_validations,
  // avisa al equipo, confirma a la profesional) y termina. No pasa por el
  // orquestador/KB. Se hace antes del freeze guard para capturar el pago
  // aunque un asesor haya tomado la conversación.
  const { data: attachMsg } = await supabase
    .from("messages")
    .select("content, attachment_path, attachment_type")
    .eq("id", job.user_message_id)
    .maybeSingle();

  if (
    attachMsg?.attachment_path &&
    attachMsg.attachment_type &&
    isAllowedComprobanteType(attachMsg.attachment_type)
  ) {
    // Gate de título profesional: si la contacta no está registrada y no
    // acreditó su título, se le pide antes de mandar el comprobante a aprobar.
    // Registradas / con título validado → flujo de comprobante normal.
    await handleAttachmentIntake({
      conversationId: job.conversation_id,
      messageId: job.user_message_id,
      attachmentPath: attachMsg.attachment_path,
      attachmentType: attachMsg.attachment_type,
      caption: attachMsg.content,
    });
    await supabase
      .from("agent_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    return;
  }

  // Freeze guard: el agente se calla SOLO si un asesor humano tomó el
  // control de la conversación (modo HUMAN). Una notificación al equipo por
  // sí sola NO congela: el agente sigue respondiendo lo que la KB cubre
  // hasta que una persona tome la conversación manualmente desde el panel.
  // (Antes congelábamos ante cualquier notificación, lo que dejaba al
  // cliente sin respuesta apenas se derivaba — ej. tras interes_compra.)
  const { data: convState } = await supabase
    .from("conversations")
    .select("mode")
    .eq("id", job.conversation_id)
    .maybeSingle();

  if (convState?.mode === "HUMAN") {
    await supabase
      .from("agent_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        error: "Conversación en modo humano: la atiende un asesor.",
      })
      .eq("id", job.id);
    return;
  }

  // Mensaje del usuario que originó el job.
  const { data: userMsg, error: userErr } = await supabase
    .from("messages")
    .select("content")
    .eq("id", job.user_message_id)
    .single();
  if (userErr || !userMsg) {
    throw new Error("No se encontró el mensaje del usuario");
  }

  // Historial: últimos N mensajes previos de la conversación.
  const { data: msgs } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", job.conversation_id)
    .order("created_at", { ascending: true });

  const history: HistoryMessage[] = (msgs ?? [])
    .filter((m) => m.id !== job.user_message_id)
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as HistoryMessage["role"], content: m.content }));

  // Correr el agente.
  const result = await runAgent({
    conversationId: job.conversation_id,
    userMessageId: job.user_message_id,
    userMessage: userMsg.content,
    history,
  });

  // El agente puede devolver varios mensajes cortos separados por una línea
  // con "---" (estilo mensajería). Se insertan como burbujas separadas.
  // Si assistantMessage viene vacío (caso típico: derivación a humano sin
  // respuesta al lead) NO se inserta ninguna burbuja del asistente — el
  // cartel de notificación (más abajo) es la única señal visible.
  const segments = result.assistantMessage
    .split(/\n\s*---\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  let lastMessageId: string | null = null;
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const { data: msg } = await supabase
      .from("messages")
      .insert({
        conversation_id: job.conversation_id,
        role: "assistant",
        content: segments[i] ?? "",
        // Solo el último mensaje del turno lleva el trace.
        trace_id: isLast ? result.traceId : null,
      })
      .select("id")
      .single();
    if (isLast && msg) lastMessageId = msg.id;
  }

  if (lastMessageId) {
    await supabase
      .from("agent_traces")
      .update({ assistant_message_id: lastMessageId })
      .eq("id", result.traceId);
  }

  // Si hubo notificación NUEVA, se inserta un "cartel" de sistema visible en
  // el panel. Si la conversación ya tenía una notificación de la misma
  // categoría (escalationIsNew === false), no repetimos el cartel: el agente
  // sigue conversando tras derivar y no queremos duplicar el aviso.
  // Mensaje sobrio (sin emoji, sin caps, sin em dash). El render le agrega el
  // ícono y la chip — ver MessageBubble role==="system".
  if (
    (result.status === "escalated" || result.status === "failed") &&
    result.escalationIsNew !== false
  ) {
    const label = humanizeCategory(result.escalationReason ?? "Notificación");
    await supabase.from("messages").insert({
      conversation_id: job.conversation_id,
      role: "system",
      content: `Derivado al equipo: ${label}`,
    });
  }

  // Reordenar la conversación.
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", job.conversation_id);

  // Entrega externa del canal (no-op en el provider de test).
  await testProvider.sendMessage(job.conversation_id, result.assistantMessage);

  // Job terminado. El estado real del agente vive en el trace.
  await supabase
    .from("agent_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      trace_id: result.traceId,
    })
    .eq("id", job.id);
}

/**
 * Maneja un fallo de infraestructura al procesar el job (no un fallo del
 * agente, que runAgent absorbe). Reintenta si quedan intentos.
 */
async function handleJobFailure(job: AgentJob, err: unknown): Promise<void> {
  const supabase = getSupabaseServerClient();
  const message = err instanceof Error ? err.message : "error desconocido";
  const exhausted = job.attempts >= job.max_attempts;

  await supabase
    .from("agent_jobs")
    .update({
      status: exhausted ? "failed" : "pending",
      error: message,
      completed_at: exhausted ? new Date().toISOString() : null,
    })
    .eq("id", job.id);

  console.error(
    `[jobs] job ${job.id} falló (intento ${job.attempts}/${job.max_attempts}): ${message}`,
  );
}
