import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { clientEnv } from "@/lib/env";
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
  args: { conversationId: string; reason: string; summary: string; paymentId: string; stillPending?: () => Promise<boolean> },
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
  if (args.stillPending && !(await args.stillPending())) return;
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
    if (args.stillPending && !(await args.stillPending())) return;
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
  conversationId: string | null,
  reason: string,
): Promise<void> {
  const query = sb.from("agent_notifications")
    .update({ resolved_at: new Date().toISOString() })
    .eq("reason", reason)
    .eq("client_slug", clientEnv.NEXT_PUBLIC_CLIENT_SLUG)
    .is("resolved_at", null);
  const { error } = await (conversationId ? query.eq("conversation_id", conversationId) : query);
  if (error) throw error;
}
