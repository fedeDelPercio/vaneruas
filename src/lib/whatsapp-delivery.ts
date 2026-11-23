import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ghlSendWhatsAppTemplate, listWhatsAppTemplates, resolveTemplate } from "@/lib/providers/ghl-templates";
import { persistWhatsAppDelivery, sendFixedWhatsApp, templateNameForContent, whatsappTemplatesEnabled, whatsappWindowOpen } from "@/lib/whatsapp-templates";
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

// Resultado de un intento de entrega:
//  - "sent": se envió a WhatsApp vía GHL.
//  - "skipped": no correspondía enviar (panel, modo humano, fuera de allowlist,
//    o contenido vacío). NO es un error.
//  - "failed": se intentó enviar y GHL devolvió error (ej. ventana de 24h
//    vencida). `error` trae el detalle.
export interface DeliveryResult {
  status: "sent" | "skipped" | "failed";
  error?: string;
  template?: string;
}

/**
 * Deja constancia de que el mensaje salió: `delivered_at` y, si GHL lo devolvió,
 * su id (dedup del webhook). Van en dos updates porque `external_id` es único:
 * si el webhook ya lo registró, ese choque no debe perder `delivered_at`. Con
 * esto se distingue un pedido de correo entregado de uno fallido (email-ask.ts).
 */
export async function markMessageDelivered(
  messageId: string,
  ghlMessageId: string | null,
  content?: string,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("messages").update({
    delivered_at: new Date().toISOString(),
    ...(content === undefined ? {} : { content }),
  }).eq("id", messageId);
  if (content !== undefined && error) {
    console.error("[whatsapp-delivery] no se pudo actualizar el texto de la plantilla:", error.message);
  }
  if (ghlMessageId) {
    const { error } = await supabase.from("messages").update({ external_id: ghlMessageId }).eq("id", messageId);
    if (content !== undefined && error) {
      console.error("[whatsapp-delivery] no se pudo guardar el id de plantilla:", error.message);
    }
  }
}

export async function deliverAssistantToWhatsApp(opts: {
  conversationId: string;
  /** Id de la fila en `messages`, para guardar el messageId de GHL (dedup). */
  messageId?: string | null;
  content: string;
}): Promise<DeliveryResult> {
  const content = opts.content.trim();
  if (!content) return { status: "skipped" };

  const supabase = getSupabaseServerClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("source, external_id, mode")
    .eq("id", opts.conversationId)
    .maybeSingle();

  // Panel (source=test): la entrega la hace Realtime. Modo humano: la IA calla.
  if (!conv || conv.source !== "whatsapp" || conv.mode === "HUMAN") return { status: "skipped" };

  const contactId = conv.external_id;
  if (!contactId || !ghlSendAllowed(contactId)) return { status: "skipped" };

  try {
    const templateName = whatsappTemplatesEnabled() ? templateNameForContent(content) : null;
    if (!templateName) {
      const ghlMessageId = await ghlSendWhatsApp(contactId, content);
      if (opts.messageId) await markMessageDelivered(opts.messageId, ghlMessageId);
      return { status: "sent" };
    }

    const { data: inbound } = await supabase.from("messages")
      .select("created_at")
      .eq("conversation_id", opts.conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const result = await sendFixedWhatsApp({
      templateName,
      windowOpen: whatsappWindowOpen(inbound?.created_at, Date.now()),
      sendText: () => ghlSendWhatsApp(contactId, content),
      resolveTemplate: async (name) => {
        const listed = await listWhatsAppTemplates();
        return { listed: listed.ok, template: await resolveTemplate(name, listed) };
      },
      sendTemplate: (id) => ghlSendWhatsAppTemplate(contactId, id),
    });

    await persistWhatsAppDelivery(result, {
      markDelivered: async (ghlMessageId, body) => {
        if (opts.messageId) {
          await markMessageDelivered(opts.messageId, ghlMessageId, body);
        } else if (body !== undefined) {
          const { error } = await supabase.from("messages").insert({
            conversation_id: opts.conversationId,
            role: "assistant",
            content: body,
            external_id: ghlMessageId,
            delivered_at: new Date().toISOString(),
          });
          if (error) console.error("[whatsapp-delivery] no se pudo guardar la plantilla enviada:", error.message);
        }
      },
      addSystemNote: async (note) => {
        const { error } = await supabase.from("messages").insert({
          conversation_id: opts.conversationId,
          role: "system",
          content: note,
        });
        if (error) console.error("[whatsapp-delivery] no se pudo guardar la nota de plantilla:", error.message);
      },
    });
    return result.template ? { status: "sent", template: result.template.name } : { status: "sent" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp-delivery] no se pudo enviar a WhatsApp:", error);
    return { status: "failed", error };
  }
}
