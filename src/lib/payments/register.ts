import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { sendTeamNotificationAlert } from "@/lib/email/sender";
import { dispatchEvent } from "@/lib/webhooks/dispatcher";
import { deliverAssistantToWhatsApp } from "@/lib/whatsapp-delivery";
import type { Json } from "@/lib/supabase/types";
import { downloadComprobante } from "./storage";
import { extractPaymentData, type PaymentExtraction } from "./extract";
import { matchEventByAmount } from "./event-match";

export const PAYMENT_NOTIFICATION_CATEGORY = "validacion_pago";

interface HandleArgs {
  conversationId: string;
  messageId: string;
  attachmentPath: string;
  attachmentType: string;
  caption?: string | null;
}

interface HandleOpts {
  // Si true, el comprobante se registra pero queda RETENIDO: no se notifica al
  // equipo todavía (falta validar el título profesional de la contacta). Se
  // libera con `releaseAwaitingComprobantes` cuando el título se valida.
  awaitingTitle?: boolean;
}

export async function handlePaymentComprobante(
  args: HandleArgs,
  opts: HandleOpts = {},
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const awaitingTitle = opts.awaitingTitle ?? false;

  // 1. Leer la imagen y extraer los datos con vision (best-effort).
  let extraction: PaymentExtraction | null = null;
  try {
    const bytes = await downloadComprobante(args.attachmentPath);
    extraction = await extractPaymentData({
      bytes,
      contentType: args.attachmentType,
    });
  } catch (err) {
    console.error("[payments] no se pudo leer el comprobante:", err);
  }

  // 1b. Chequear si el N° de operación ya figura registrado (posible doble
  //     envío del mismo comprobante). Best-effort.
  let isDuplicate = false;
  const opNumber = extraction?.operation_number?.trim();
  if (opNumber) {
    try {
      const { data: existing } = await supabase
        .from("payment_validations")
        .select("id")
        .eq("operation_number", opNumber)
        .limit(1);
      isDuplicate = Boolean(existing?.length);
    } catch (err) {
      console.error("[payments] no se pudo chequear duplicados:", err);
    }
  }

  // 1c. Identificar el evento por el monto (hardcode temporal: cada comprobante
  //     que llega tiene un monto exacto distinto por evento). Así el equipo lo
  //     ve etiquetado y el agente no tiene que preguntar a qué corresponde.
  const matchedEvent = matchEventByAmount(extraction?.amount ?? null);

  // 2. Registrar la fila de validación (siempre, aunque el OCR falle).
  const { data: inserted, error: insertErr } = await supabase
    .from("payment_validations")
    .insert({
      conversation_id: args.conversationId,
      message_id: args.messageId,
      comprobante_path: args.attachmentPath,
      comprobante_type: args.attachmentType,
      event_slug: matchedEvent?.slug ?? null,
      sender_name: extraction?.sender_name ?? null,
      sender_tax_id: extraction?.sender_tax_id ?? null,
      recipient_name: extraction?.recipient_name ?? null,
      recipient_tax_id: extraction?.recipient_tax_id ?? null,
      amount: extraction?.amount ?? null,
      currency: extraction?.currency ?? null,
      transfer_date_raw: extraction?.transfer_date_raw ?? null,
      transferred_at: extraction?.transferred_at ?? null,
      operation_number: extraction?.operation_number ?? null,
      bank_or_method: extraction?.bank_or_method ?? null,
      concept: extraction?.concept ?? null,
      extraction: (extraction as unknown as Json) ?? null,
      extraction_confidence: extraction?.confidence ?? null,
      status: "pending",
      awaiting_title: awaitingTitle,
    })
    .select("id")
    .single();
  if (insertErr) {
    console.error("[payments] no se pudo registrar el pago:", insertErr.message);
  }

  // Comprobante RETENIDO: el pago NO se manda a validar todavía (falta el
  // título). Pero sí avisamos al equipo que hay una contacta esperando acreditar
  // su título, así no queda en silencio: aparece en el panel y, si quiere, una
  // persona puede mirar el caso (validar el título o forzar la aprobación).
  if (awaitingTitle) {
    await notifyTeamOfPayment({
      conversationId: args.conversationId,
      messageId: args.messageId,
      paymentId: inserted?.id ?? null,
      extraction,
      isDuplicate,
      reasonOverride:
        "Comprobante recibido, la contacta debe acreditar su título profesional antes de aprobar",
      extraNote:
        "Comprobante RETENIDO: esperando que la contacta acredite su título. Validá el título desde el panel para habilitarlo, o forzá la aprobación si corresponde.",
    });
    await supabase.from("messages").insert({
      conversation_id: args.conversationId,
      role: "system",
      content: "Comprobante recibido, esperando validación del título profesional",
    });
    const titleAskMsg =
      "Genial, recibí tu comprobante 🙌 Para confirmar tu inscripción necesito validar que seas profesional del rubro, me compartís una foto o PDF de tu título o certificado de alumno en curso como profesional de la estetica? Apenas lo valide, mando tu pago a aprobar ✨";
    const { data: titleAsk } = await supabase
      .from("messages")
      .insert({ conversation_id: args.conversationId, role: "assistant", content: titleAskMsg })
      .select("id")
      .single();
    await deliverAssistantToWhatsApp({
      conversationId: args.conversationId,
      messageId: titleAsk?.id,
      content: titleAskMsg,
    });
    await touchConversation(args.conversationId);
    return;
  }

  // 3. Avisar al equipo: agent_notifications + email + webhook.
  await notifyTeamOfPayment({
    conversationId: args.conversationId,
    messageId: args.messageId,
    paymentId: inserted?.id ?? null,
    extraction,
    isDuplicate,
  });

  // 4. Cartel de sistema en el panel.
  await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    role: "system",
    content: "Comprobante de pago recibido, pendiente de validación",
  });

  // 5. Confirmación a la profesional.
  const receivedMsg =
    "Genial, gracias por compartir el comprobante 🙌 El equipo lo revisa y te confirma la inscripción a la brevedad";
  const { data: received } = await supabase
    .from("messages")
    .insert({ conversation_id: args.conversationId, role: "assistant", content: receivedMsg })
    .select("id")
    .single();
  await deliverAssistantToWhatsApp({
    conversationId: args.conversationId,
    messageId: received?.id,
    content: receivedMsg,
  });

  // 6. Reordenar la conversación.
  await touchConversation(args.conversationId);
}

/**
 * Libera los comprobantes que quedaron retenidos esperando el título de una
 * conversación: marca awaiting_title=false y recién ahí notifica al equipo. Se
 * llama cuando el título profesional se validó. Devuelve cuántos liberó.
 */
export async function releaseAwaitingComprobantes(
  conversationId: string,
): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("payment_validations")
    .select("id, message_id, extraction")
    .eq("conversation_id", conversationId)
    .eq("awaiting_title", true)
    .eq("status", "pending");
  if (error || !rows?.length) return 0;

  let released = 0;
  for (const row of rows) {
    await supabase
      .from("payment_validations")
      .update({ awaiting_title: false, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    const extraction = (row.extraction as unknown as PaymentExtraction) ?? null;
    await notifyTeamOfPayment({
      conversationId,
      messageId: row.message_id,
      paymentId: row.id,
      extraction,
      isDuplicate: false,
      extraNote: "Título profesional validado por IA antes de habilitar el pago.",
    });
    released++;
  }
  return released;
}

/**
 * Notifica al equipo de un comprobante listo para validar: registro interno,
 * email y webhook. Cada canal en su propio try para que la falla de uno no
 * bloquee a los otros.
 */
async function notifyTeamOfPayment(args: {
  conversationId: string;
  messageId: string | null;
  paymentId: string | null;
  extraction: PaymentExtraction | null;
  isDuplicate: boolean;
  extraNote?: string;
  reasonOverride?: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  const summary = buildTeamSummary(args.extraction, args.isDuplicate, args.extraNote);
  const reason =
    args.reasonOverride ??
    (args.isDuplicate
      ? "Comprobante con N° de operación ya registrado, posible doble envío"
      : args.extraction?.is_payment_receipt === false
        ? "La imagen recibida no parece un comprobante de pago"
        : "Comprobante de pago recibido, pendiente de validación manual");

  try {
    await supabase.from("agent_notifications").insert({
      conversation_id: args.conversationId,
      category: PAYMENT_NOTIFICATION_CATEGORY,
      reason,
      summary,
    });
  } catch (err) {
    console.error("[payments] no se pudo registrar la notificación interna:", err);
  }

  try {
    const { data: conv } = await supabase
      .from("conversations")
      .select("source")
      .eq("id", args.conversationId)
      .maybeSingle();

    await sendTeamNotificationAlert({
      category: PAYMENT_NOTIFICATION_CATEGORY,
      reason,
      summary,
      conversationId: args.conversationId,
      conversationSource: conv?.source ?? null,
      paymentId: args.paymentId,
    });
  } catch (err) {
    console.error("[payments] no se pudo enviar el email al equipo:", err);
  }

  try {
    await dispatchEvent("payment.received", {
      conversationId: args.conversationId,
      messageId: args.messageId,
      amount: args.extraction?.amount ?? null,
      senderName: args.extraction?.sender_name ?? null,
      operationNumber: args.extraction?.operation_number ?? null,
    });
  } catch (err) {
    console.error("[payments] no se pudo despachar el webhook:", err);
  }
}

async function touchConversation(conversationId: string): Promise<void> {
  await getSupabaseServerClient()
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

function buildTeamSummary(
  extraction: PaymentExtraction | null,
  isDuplicate = false,
  extraNote?: string,
): string {
  const dupNote = isDuplicate
    ? "Atención: el N° de operación de este comprobante ya figura registrado, puede ser un doble envío.\n\n"
    : "";
  const tail = extraNote ? `\n\n${extraNote}` : "";

  if (!extraction) {
    return (
      dupNote +
      [
        "Llegó un comprobante pero no se pudo leer automáticamente.",
        "Abrí la imagen en el panel y validá los datos manualmente.",
      ].join(" ") +
      tail
    );
  }
  if (extraction.is_payment_receipt === false) {
    return (
      dupNote +
      "La profesional envió una imagen que no parece un comprobante de pago. Revisala en el panel." +
      tail
    );
  }

  const lines: string[] = [];
  if (dupNote) lines.push(dupNote.trimEnd());
  lines.push("Datos leídos del comprobante:");
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") {
      lines.push(`- ${label}: ${value}`);
    }
  };
  add("Quién envía", extraction.sender_name);
  add("CUIT/CUIL emisor", extraction.sender_tax_id);
  add(
    "Monto",
    extraction.amount !== null
      ? `${extraction.currency ?? "ARS"} ${formatAmount(extraction.amount)}`
      : null,
  );
  add("Fecha", extraction.transfer_date_raw);
  add("Destinatario", extraction.recipient_name);
  add("N° de operación", extraction.operation_number);
  add("Banco / medio", extraction.bank_or_method);
  add("Concepto", extraction.concept);
  lines.push("");
  lines.push(`Confianza de la lectura: ${extraction.confidence}.`);
  lines.push("Validá el pago manualmente contra la contabilidad desde el panel.");
  return lines.join("\n") + tail;
}

function formatAmount(amount: number): string {
  try {
    return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0 }).format(amount);
  } catch {
    return String(amount);
  }
}
