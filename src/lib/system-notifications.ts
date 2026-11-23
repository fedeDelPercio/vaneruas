import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { sendTeamNotificationAlert } from "@/lib/email/sender";

type Db = SupabaseClient<Database>;

// Categoría existente para respetar el CHECK de la base compartida.
const SYSTEM_CATEGORY = "escalado_manual";

/**
 * Una notificación abierta por caso: si ya hay una sin resolver con la misma
 * marca, solo se actualiza el motivo (y no se repite el email).
 */
export async function openSystemNotification(
  sb: Db,
  args: { conversationId: string; reason: string; summary: string; paymentId: string },
): Promise<void> {
  const { data: open, error: openErr } = await sb
    .from("agent_notifications")
    .select("id, summary")
    .eq("conversation_id", args.conversationId)
    .eq("reason", args.reason)
    .is("resolved_at", null)
    .limit(1);
  if (openErr) {
    console.error("[system-notifications] no se pudo leer las notificaciones abiertas:", openErr.message);
    return;
  }
  const current = open?.[0];
  if (current) {
    if (current.summary !== args.summary) {
      await sb.from("agent_notifications").update({ summary: args.summary }).eq("id", current.id);
    }
    return;
  }

  const { error } = await sb.from("agent_notifications").insert({
    conversation_id: args.conversationId,
    category: SYSTEM_CATEGORY,
    reason: args.reason,
    summary: args.summary,
  });
  if (error) {
    console.error("[system-notifications] no se pudo registrar la notificación:", error.message);
    return;
  }

  try {
    const { data: conv } = await sb
      .from("conversations")
      .select("source")
      .eq("id", args.conversationId)
      .maybeSingle();
    await sendTeamNotificationAlert({
      category: SYSTEM_CATEGORY,
      reason: args.reason,
      summary: args.summary,
      conversationId: args.conversationId,
      conversationSource: conv?.source ?? null,
      paymentId: args.paymentId,
    });
  } catch (err) {
    console.error("[system-notifications] no se pudo enviar el email al equipo:", err);
  }
}

export async function resolveSystemNotification(
  sb: Db,
  conversationId: string,
  reason: string,
): Promise<void> {
  await sb
    .from("agent_notifications")
    .update({ resolved_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("reason", reason)
    .is("resolved_at", null);
}
