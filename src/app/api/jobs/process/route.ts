import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { runAgent } from "@/lib/agent/run";
import { ghlSendAllowed, ghlSendWhatsApp } from "@/lib/providers/ghl";
import { isAllowedComprobanteType } from "@/lib/payments/storage";
import { handleAttachmentIntake } from "@/lib/titles/handle";
import { resolveWhatsAppTurn } from "@/lib/agent/debounce";
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

  const claimed = jobs ?? [];
  let processed = 0;
  let failed = 0;
  // Secuencial: evita levantar varias sesiones del Agent SDK en paralelo.
  for (const job of claimed) {
    try {
      await processJob(job);
      processed++;
    } catch (err) {
      await handleJobFailure(job, err);
      failed++;
    }
  }

  // Reintentos de entrega a WhatsApp que quedaron pendientes (corre siempre,
  // incluso sin jobs nuevos, porque también lo dispara el cron de cada minuto).
  await drainWaOutbox();

  return NextResponse.json({ claimed: claimed.length, processed, failed });
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

  // Si la imagen "otro" trae texto de otra intención, el intake NO la maneja y
  // cae al flujo normal del agente (que se presenta y deriva). Lo recordamos
  // para forzar el turno sobre ESE mensaje (sin debounce sobre adjuntos).
  let attachmentFellThrough = false;
  if (
    attachMsg?.attachment_path &&
    attachMsg.attachment_type &&
    isAllowedComprobanteType(attachMsg.attachment_type)
  ) {
    // Gate de título profesional: si la contacta no está registrada y no
    // acreditó su título, se le pide antes de mandar el comprobante a aprobar.
    // Registradas / con título validado → flujo de comprobante normal.
    const { handled } = await handleAttachmentIntake({
      conversationId: job.conversation_id,
      messageId: job.user_message_id,
      attachmentPath: attachMsg.attachment_path,
      attachmentType: attachMsg.attachment_type,
      caption: attachMsg.content,
    });
    if (handled) {
      await supabase
        .from("agent_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", job.id);
      return;
    }
    attachmentFellThrough = true;
  }

  // Freeze guard: el agente se calla SOLO si un asesor humano tomó el
  // control de la conversación (modo HUMAN). Una notificación al equipo por
  // sí sola NO congela: el agente sigue respondiendo lo que la KB cubre
  // hasta que una persona tome la conversación manualmente desde el panel.
  // (Antes congelábamos ante cualquier notificación, lo que dejaba al
  // cliente sin respuesta apenas se derivaba — ej. tras interes_compra.)
  const { data: convState } = await supabase
    .from("conversations")
    .select("mode, source, external_id, wa_jid")
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

  // Todos los mensajes de la conversación (para historial y, en WhatsApp, para
  // consolidar el turno de mensajes acumulados por el debounce).
  const { data: msgs } = await supabase
    .from("messages")
    .select("id, role, content, created_at, attachment_path")
    .eq("conversation_id", job.conversation_id)
    .order("created_at", { ascending: true });
  const allMsgs = msgs ?? [];

  // Resolver el "turno" a responder:
  //  - WhatsApp: acumulación de mensajes. Esperamos un período de silencio
  //    (debounce) y consolidamos los mensajes seguidos en una sola respuesta.
  //    Si la ventana todavía no pasó, re-diferimos el job y salimos sin
  //    responder (lo procesa un disparo posterior, cuando haya silencio).
  //  - Panel Testing (source != whatsapp): turno = el mensaje que originó el job.
  const isWhatsApp = convState?.source === "whatsapp";
  const debounceSeconds = serverEnv().MESSAGE_DEBOUNCE_SECONDS;

  let turnUserMessage: string;
  let anchorMessageId: string;
  let turnMessageIds: Set<string>;

  if (isWhatsApp && debounceSeconds > 0 && !attachmentFellThrough) {
    const decision = resolveWhatsAppTurn(allMsgs, debounceSeconds, Date.now());
    if (decision.action === "skip") {
      // Turno ya respondido o solo adjuntos: no-op.
      await markJobCompleted(job.id);
      return;
    }
    if (decision.action === "defer") {
      // Todavía acumulando: re-diferimos el job y salimos sin responder.
      await deferJob(job, decision.processAfter);
      return;
    }
    turnUserMessage = decision.userMessage;
    anchorMessageId = decision.anchorMessageId;
    turnMessageIds = new Set(decision.turnMessageIds);
  } else {
    const originMsg = allMsgs.find((m) => m.id === job.user_message_id);
    if (!originMsg) throw new Error("No se encontró el mensaje del usuario");
    turnUserMessage = originMsg.content ?? "";
    anchorMessageId = job.user_message_id;
    turnMessageIds = new Set([job.user_message_id]);
  }

  // Captura del correo: si el turno trae un email (típico tras validar el pago,
  // cuando le pedimos el correo para el acceso), lo guardamos en la conversación.
  // Best-effort: no corta el flujo del agente.
  await captureContactEmail(job.conversation_id, turnUserMessage);

  // Historial: mensajes previos al turno actual, últimos N.
  const history: HistoryMessage[] = allMsgs
    .filter((m) => !turnMessageIds.has(m.id))
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as HistoryMessage["role"], content: m.content }));

  // Correr el agente.
  const result = await runAgent({
    conversationId: job.conversation_id,
    userMessageId: anchorMessageId,
    userMessage: turnUserMessage,
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
  // Burbujas insertadas (id + texto) para entregarlas al canal y, en WhatsApp,
  // guardar el messageId de GHL en cada una (dedup del webhook OutboundMessage).
  const insertedSegments: { id: string; content: string }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const segment = segments[i] ?? "";
    const { data: msg } = await supabase
      .from("messages")
      .insert({
        conversation_id: job.conversation_id,
        role: "assistant",
        content: segment,
        // Solo el último mensaje del turno lleva el trace.
        trace_id: isLast ? result.traceId : null,
      })
      .select("id")
      .single();
    if (msg) insertedSegments.push({ id: msg.id, content: segment });
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

  // Entrega externa del canal. Para WhatsApp (GHL) se manda cada burbuja por
  // separado; para el panel (test) es no-op (Realtime ya refleja `messages`).
  await deliverAgentReply({
    source: convState?.source ?? "test",
    contactId: convState?.external_id ?? null,
    phone: convState?.wa_jid ?? null,
    conversationId: job.conversation_id,
    segments: insertedSegments,
  });

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

// Email simple: suficiente para capturar el correo que comparte la contacta.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * Si el mensaje del usuario contiene un correo, lo guarda en
 * conversations.contact_email (lo último que mande pisa lo anterior). Best-
 * effort: cualquier error se loguea y no interrumpe el procesamiento del job.
 */
async function captureContactEmail(
  conversationId: string,
  content: string | null,
): Promise<void> {
  const match = content?.match(EMAIL_RE);
  if (!match) return;
  const email = match[0].toLowerCase();
  try {
    await getSupabaseServerClient()
      .from("conversations")
      .update({ contact_email: email })
      .eq("id", conversationId);
  } catch (err) {
    console.error("[jobs] no se pudo guardar el correo de la contacta:", err);
  }
}

/** Marca un job como terminado sin respuesta (turno ya respondido / vacío). */
async function markJobCompleted(jobId: string): Promise<void> {
  await getSupabaseServerClient()
    .from("agent_jobs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", jobId);
}

/**
 * Re-difiere un job: el turno todavía está acumulando mensajes (llegó uno
 * dentro de la ventana de debounce). Vuelve a 'pending' con un nuevo
 * `process_after` y devuelve el intento (no fue un fallo, no debe contar para
 * el límite de reintentos).
 */
async function deferJob(job: AgentJob, processAfter: string): Promise<void> {
  await getSupabaseServerClient()
    .from("agent_jobs")
    .update({
      status: "pending",
      process_after: processAfter,
      attempts: Math.max(0, job.attempts - 1),
      started_at: null,
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

// Máximo de reintentos de entrega antes de abandonar una fila del outbox.
const MAX_OUTBOX_ATTEMPTS = 5;

/**
 * Entrega la respuesta del agente por el canal. Para WhatsApp manda cada
 * burbuja a GHL; si el envío falla, encola en `wa_outbox` para que el cron
 * reintente. Respeta la allowlist (fail-closed). Para el panel (test) es
 * no-op: Realtime ya refleja la tabla `messages`.
 */
async function deliverAgentReply(opts: {
  source: string;
  contactId: string | null;
  phone: string | null;
  conversationId: string;
  segments: { id: string; content: string }[];
}): Promise<void> {
  if (opts.source !== "whatsapp") return;
  const { contactId } = opts;
  if (!contactId) return;

  // Guardrail: solo se envía a contactos habilitados en la allowlist.
  if (!ghlSendAllowed(contactId)) {
    console.debug(`[ghl] envío omitido (fuera de allowlist): ${contactId}`);
    return;
  }

  const supabase = getSupabaseServerClient();
  for (const segment of opts.segments) {
    try {
      const ghlMessageId = await ghlSendWhatsApp(contactId, segment.content);
      // Guardar el messageId de GHL en la burbuja, para deduplicar después el
      // webhook OutboundMessage (que va a reportar este mismo envío).
      if (ghlMessageId) {
        await supabase
          .from("messages")
          .update({ external_id: ghlMessageId })
          .eq("id", segment.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "error desconocido";
      console.error(`[ghl] envío falló, encolo en wa_outbox: ${message}`);
      await supabase.from("wa_outbox").insert({
        conversation_id: opts.conversationId,
        phone: opts.phone ?? contactId,
        content: segment.content,
        attempts: 1,
        error: message,
      });
    }
  }
}

/**
 * Reintenta las entregas pendientes en `wa_outbox` (las que el envío inline
 * no pudo completar). Lo llama el cron cada minuto. Resuelve el contactId
 * desde la conversación y respeta la allowlist.
 */
async function drainWaOutbox(): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { data: rows } = await supabase
    .from("wa_outbox")
    .select("id, conversation_id, content, attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_OUTBOX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(20);
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("external_id")
      .eq("id", row.conversation_id)
      .maybeSingle();
    const contactId = conv?.external_id ?? null;

    if (!contactId || !ghlSendAllowed(contactId)) {
      // Sin destino o fuera de allowlist: cuenta el intento para que no se
      // reintente para siempre, pero no se envía.
      await supabase
        .from("wa_outbox")
        .update({ attempts: row.attempts + 1, error: "sin contactId o fuera de allowlist" })
        .eq("id", row.id);
      continue;
    }

    try {
      await ghlSendWhatsApp(contactId, row.content);
      await supabase
        .from("wa_outbox")
        .update({ sent_at: new Date().toISOString(), error: null })
        .eq("id", row.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "error desconocido";
      await supabase
        .from("wa_outbox")
        .update({ attempts: row.attempts + 1, error: message })
        .eq("id", row.id);
    }
  }
}
