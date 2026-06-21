import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ghlSendAllowed, ghlSendWhatsApp } from "@/lib/providers/ghl";

// ===========================================================================
// Entrega de mensajes del asistente a WhatsApp (vía GHL) para los flujos que
// insertan mensajes FUERA del loop normal del agente: comprobante, validación
// de título, aprobación de pago. Esos mensajes se persisten en `messages`
// (system of record) pero, sin esto, NO se mandaban al WhatsApp del contacto
// (solo quedaban en el panel). El loop normal del agente ya entrega por su
// cuenta (ver deliverAgentReply en jobs/process).
//
// Solo entrega cuando la conversación es de WhatsApp, NO está en modo humano,
// y el contacto está habilitado en la allowlist (GHL_SEND_ALLOWLIST).
// ===========================================================================

export async function deliverAssistantToWhatsApp(opts: {
  conversationId: string;
  /** Id de la fila en `messages`, para guardar el messageId de GHL (dedup). */
  messageId?: string | null;
  content: string;
}): Promise<void> {
  const content = opts.content.trim();
  if (!content) return;

  const supabase = getSupabaseServerClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("source, external_id, mode")
    .eq("id", opts.conversationId)
    .maybeSingle();

  // Panel (source=test): la entrega la hace Realtime. Modo humano: la IA calla.
  if (!conv || conv.source !== "whatsapp" || conv.mode === "HUMAN") return;

  const contactId = conv.external_id;
  if (!contactId || !ghlSendAllowed(contactId)) return;

  try {
    const ghlMessageId = await ghlSendWhatsApp(contactId, content);
    if (ghlMessageId && opts.messageId) {
      await supabase
        .from("messages")
        .update({ external_id: ghlMessageId })
        .eq("id", opts.messageId);
    }
  } catch (err) {
    console.error(
      "[whatsapp-delivery] no se pudo enviar a WhatsApp:",
      err instanceof Error ? err.message : err,
    );
  }
}
