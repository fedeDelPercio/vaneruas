import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { sendTeamNotificationAlert } from "@/lib/email/sender";
import { dispatchEvent } from "@/lib/webhooks/dispatcher";
import type { Json } from "@/lib/supabase/types";
import { downloadComprobante } from "./storage";
import { extractPaymentData, type PaymentExtraction } from "./extract";

// ===========================================================================
// Flujo de captura de comprobante de pago.
//
// Se dispara cuando entra un mensaje con una imagen adjunta (el comprobante).
// Corre por fuera del orquestador/KB: lee el comprobante con vision, lo
// registra en payment_validations (estado 'pending'), avisa al equipo (email +
// webhook + cartel en el panel) y le confirma a la profesional que lo
// recibimos. El equipo valida después manualmente desde el panel.
//
// A diferencia de las derivaciones (notify_team), cada comprobante genera su
// propia notificación: no se deduplica por categoría, porque una conversación
// puede traer varios pagos distintos.
// ===========================================================================

export const PAYMENT_NOTIFICATION_CATEGORY = "validacion_pago";

interface HandleArgs {
  conversationId: string;
  messageId: string;
  attachmentPath: string;
  attachmentType: string;
  /** Texto que acompañó la imagen (caption), si lo hubo. */
  caption?: string | null;
}

/** Procesa un comprobante de punta a punta. No lanza: registra el error y sigue. */
export async function handlePaymentComprobante(args: HandleArgs): Promise<void> {
  const supabase = getSupabaseServerClient();

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

  // 2. Registrar la fila de validación (siempre, aunque el OCR falle: la
  //    imagen queda guardada para validación manual).
  const { data: inserted, error: insertErr } = await supabase
    .from("payment_validations")
    .insert({
    conversation_id: args.conversationId,
    message_id: args.messageId,
    comprobante_path: args.attachmentPath,
    comprobante_type: args.attachmentType,
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
    })
    .select("id")
    .single();
  if (insertErr) {
    console.error("[payments] no se pudo registrar el pago:", insertErr.message);
  }

  // 3. Avisar al equipo: agent_notifications + email + webhook + cartel.
  const summary = buildTeamSummary(extraction);
  const reason = extraction?.is_payment_receipt === false
    ? "La imagen recibida no parece un comprobante de pago"
    : "Comprobante de pago recibido, pendiente de validación manual";

  try {
    await supabase.from("agent_notifications").insert({
      conversation_id: args.conversationId,
      category: PAYMENT_NOTIFICATION_CATEGORY,
      reason,
      summary,
    });

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
      paymentId: inserted?.id ?? null,
    });

    await dispatchEvent("payment.received", {
      conversationId: args.conversationId,
      messageId: args.messageId,
      amount: extraction?.amount ?? null,
      senderName: extraction?.sender_name ?? null,
      operationNumber: extraction?.operation_number ?? null,
    });
  } catch (err) {
    console.error("[payments] falló el aviso al equipo:", err);
  }

  // 4. Cartel de sistema en el panel (sobrio, sin emoji ni punto final).
  await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    role: "system",
    content: "Comprobante de pago recibido, pendiente de validación",
  });

  // 5. Confirmación a la profesional (microcopy de agente: sin emoji, sin
  //    em dash, sin punto final, sin signos de apertura).
  await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    role: "assistant",
    content:
      "Recibimos tu comprobante, el equipo lo valida y te confirma la inscripción a la brevedad",
  });

  // 6. Reordenar la conversación.
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", args.conversationId);
}

/** Arma el resumen que lee el equipo en el email y en el panel. */
function buildTeamSummary(extraction: PaymentExtraction | null): string {
  if (!extraction) {
    return [
      "Llegó un comprobante pero no se pudo leer automáticamente.",
      "Abrí la imagen en el panel y validá los datos manualmente.",
    ].join(" ");
  }
  if (extraction.is_payment_receipt === false) {
    return "La profesional envió una imagen que no parece un comprobante de pago. Revisala en el panel.";
  }

  const lines: string[] = ["Datos leídos del comprobante:"];
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
  return lines.join("\n");
}

function formatAmount(amount: number): string {
  try {
    return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0 }).format(amount);
  } catch {
    return String(amount);
  }
}
