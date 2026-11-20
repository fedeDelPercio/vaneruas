import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { findEmailInMessages, normalizeContactEmail } from "@/lib/contact-email";
import { clientEnv } from "@/lib/env";
import { EMAIL_ASK_MESSAGES } from "./messages";

// ===========================================================================
// Lecturas para decidir si se pide el correo (ver email-ask.ts para la regla).
// ===========================================================================

type Db = SupabaseClient<Database>;

/** Mensajes de la contacta que se leen por página buscando un correo. */
const HISTORY_PAGE = 200;
/** Tope de páginas (10.000 mensajes): una conversación real no llega. */
const HISTORY_MAX_PAGES = 50;

/**
 * Correo más reciente que la contacta escribió en TODO el historial de la
 * conversación (mensajes role='user', incluidos los captions de adjuntos, que
 * viajan en `content`). Lee de a 200, del más nuevo al más viejo, y corta en
 * el primer hit. Solo lectura. Lanza si falla la lectura.
 */
export async function findContactEmailInHistory(
  sb: Db,
  conversationId: string,
  clientSlug: string = clientEnv.NEXT_PUBLIC_CLIENT_SLUG,
): Promise<string | null> {
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const from = page * HISTORY_PAGE;
    const { data, error } = await sb
      .from("messages")
      .select("content")
      .eq("conversation_id", conversationId)
      .eq("client_slug", clientSlug)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .range(from, from + HISTORY_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const hit = findEmailInMessages(rows);
    if (hit) return hit;
    if (rows.length < HISTORY_PAGE) return null;
  }
  return null;
}

/**
 * Correo válido de la conversación. Si no está guardado pero la contacta lo
 * escribió en algún mensaje (pasa cuando lo manda junto a una imagen, o mucho
 * antes de que se lo pidan), se rescata y se guarda: así no se lo pedimos y el
 * alta en Tiendup lo encuentra. Ante error devuelve null (se pide: mejor eso
 * que dejarla sin acceso).
 */
export async function resolveConversationEmail(sb: Db, conversationId: string): Promise<string | null> {
  const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;
  try {
    const { data: conv } = await sb
      .from("conversations")
      .select("contact_email")
      .eq("id", conversationId)
      .eq("client_slug", slug)
      .maybeSingle();
    const current = normalizeContactEmail(conv?.contact_email);
    if (current) return current;
    const hit = await findContactEmailInHistory(sb, conversationId, slug);
    if (hit) {
      await sb
        .from("conversations")
        .update({ contact_email: hit })
        .eq("id", conversationId)
        .eq("client_slug", slug);
    }
    return hit;
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
