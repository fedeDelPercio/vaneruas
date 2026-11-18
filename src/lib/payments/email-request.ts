import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { extractContactEmail, normalizeContactEmail } from "@/lib/contact-email";
import { EMAIL_ASK_MESSAGES } from "./messages";

// ===========================================================================
// Lecturas para decidir si se pide el correo (ver email-ask.ts para la regla).
// ===========================================================================

type Db = SupabaseClient<Database>;

/** Mensajes de la contacta que se miran buscando un correo que ya dejó. */
const EMAIL_LOOKBACK = 15;

/**
 * Correo válido de la conversación. Si no está guardado pero la contacta lo
 * escribió en sus últimos mensajes (pasa cuando lo manda junto a una imagen),
 * se rescata y se guarda: así no se lo pedimos y el alta en Tiendup lo
 * encuentra. Ante error devuelve null (se pide: mejor eso que dejarla sin
 * acceso).
 */
export async function resolveConversationEmail(sb: Db, conversationId: string): Promise<string | null> {
  try {
    const { data: conv } = await sb
      .from("conversations")
      .select("contact_email")
      .eq("id", conversationId)
      .maybeSingle();
    const current = normalizeContactEmail(conv?.contact_email);
    if (current) return current;
    const { data: previos } = await sb
      .from("messages")
      .select("content")
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(EMAIL_LOOKBACK);
    for (const m of previos ?? []) {
      const hit = extractContactEmail(m.content);
      if (hit) {
        await sb.from("conversations").update({ contact_email: hit }).eq("id", conversationId);
        return hit;
      }
    }
    return null;
  } catch (err) {
    console.error("[payments] no se pudo leer el correo de la conversación:", err);
    return null;
  }
}

/**
 * Desde cuándo cuenta "este pago" para no pedir el correo dos veces: el primer
 * comprobante del mismo evento en la conversación (mismo criterio que el aviso
 * de acceso a Tiendup). Sin evento, el propio comprobante.
 */
export async function paymentPeriodStart(
  sb: Db,
  args: { conversationId: string; eventSlug: string | null; paymentId: string },
): Promise<string> {
  let q = sb
    .from("payment_validations")
    .select("created_at")
    .eq("conversation_id", args.conversationId)
    .order("created_at", { ascending: true })
    .limit(1);
  q = args.eventSlug ? q.eq("event_slug", args.eventSlug) : q.eq("id", args.paymentId);
  const { data } = await q.maybeSingle();
  return data?.created_at ?? new Date(0).toISOString();
}

/**
 * ¿Ya le pedimos el correo desde `sinceIso`? Ante error de lectura devuelve
 * true: un pedido repetido confunde más que la confirmación sin pedido (el
 * equipo igual ve "falta el correo" en Falta acceso).
 */
export async function emailAlreadyAsked(sb: Db, conversationId: string, sinceIso: string): Promise<boolean> {
  const { data, error } = await sb
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .in("content", [...EMAIL_ASK_MESSAGES])
    .gte("created_at", sinceIso)
    .limit(1);
  if (error) return true;
  return Boolean(data?.length);
}
