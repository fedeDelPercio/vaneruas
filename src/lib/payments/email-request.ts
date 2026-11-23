import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  extractContactEmail,
  findEmailInMessages,
  NEW_PURCHASE_EMAIL_GRACE_MS,
  normalizeContactEmail,
  type NewPurchaseContext,
} from "@/lib/contact-email";
import { clientEnv } from "@/lib/env";
import { esAgrupado } from "./dismiss";
import { hasDeliveredEmailAsk } from "./email-ask";
import { accesoVigenteDeEvento } from "./event-match";

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
 * ¿Ya le pedimos el correo desde `sinceIso` y el pedido LLEGÓ? Cuenta los textos
 * fijos y los redactados por el agente; uno que no se entregó (ventana de 24 h
 * cerrada, modo humano) no cuenta. Ante error de lectura devuelve true: un
 * pedido repetido confunde más que la confirmación sin pedido (el equipo igual
 * ve "falta el correo" en Falta acceso).
 */
export async function emailAlreadyAsked(sb: Db, conversationId: string, sinceIso: string): Promise<boolean> {
  const [{ data: conv, error: convErr }, { data, error }] = await Promise.all([
    sb.from("conversations").select("source").eq("id", conversationId).maybeSingle(),
    sb
      .from("messages")
      .select("content, external_id, delivered_at, created_at")
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (error || convErr) return true;
  return hasDeliveredEmailAsk(data ?? [], conv?.source);
}

/** Primera vez que `email` aparece en un mensaje de la contacta. Lanza si falla la lectura. */
async function emailFirstSeenAt(sb: Db, conversationId: string, email: string): Promise<string | null> {
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const from = page * HISTORY_PAGE;
    const { data, error } = await sb
      .from("messages")
      .select("content, created_at")
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .range(from, from + HISTORY_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const m of rows) {
      const text = (m.content ?? "").toLowerCase();
      if (text.includes(email) || extractContactEmail(text) === email) return m.created_at;
    }
    if (rows.length < HISTORY_PAGE) return null;
  }
  return null;
}

/**
 * Datos de la compra en curso (último comprobante no descartado) para decidir
 * si un correo nuevo pisa al guardado. null si no hay compra o falla una
 * lectura: entonces rige la regla conservadora (no se pisa).
 */
export async function loadNewPurchaseContext(
  sb: Db,
  args: { conversationId: string; storedEmail: string; incomingAtIso: string },
): Promise<NewPurchaseContext | null> {
  try {
    const { data: pays, error } = await sb
      .from("payment_validations")
      .select("id, status, event_slug, created_at, course_access_granted_at, validation_note")
      .eq("conversation_id", args.conversationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return null;
    const live = (pays ?? []).filter((p) => !esAgrupado(p) && p.status !== "rejected");
    const latest = live[0];
    if (!latest) return null;
    const periodStartIso = await paymentPeriodStart(sb, {
      conversationId: args.conversationId,
      eventSlug: latest.event_slug ?? null,
      paymentId: latest.id,
    });
    const sameEvent = (p: (typeof live)[number]) =>
      latest.event_slug ? p.event_slug === latest.event_slug : p.id === latest.id;
    const { data: notes, error: notesErr } = await sb
      .from("messages")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("role", "system")
      .like("content", "Mail corregido por el equipo%")
      .gte("created_at", periodStartIso)
      .limit(1);
    if (notesErr) return null;
    return {
      periodStartIso,
      incomingAtIso: args.incomingAtIso,
      storedFirstSeenAtIso: await emailFirstSeenAt(sb, args.conversationId, args.storedEmail),
      periodAccessGranted: live.some((p) => sameEvent(p) && Boolean(p.course_access_granted_at)),
      otherEventAwaitingAccess: live.some(
        (p) =>
          !sameEvent(p) &&
          p.status === "validated" &&
          !p.course_access_granted_at &&
          accesoVigenteDeEvento(p.event_slug),
      ),
      teamCorrectedInPeriod: Boolean(notes?.length),
    };
  } catch (err) {
    console.error("[payments] no se pudo leer la compra en curso:", err instanceof Error ? err.message : "error");
    return null;
  }
}

/**
 * Correo más reciente escrito cerca de la compra en curso (desde el margen
 * previo al primer comprobante). Cubre "nombre + mail" y la foto un momento
 * después, cuando el job del comprobante no trae el correo en su texto.
 */
export async function findEmailNearPurchase(
  sb: Db,
  conversationId: string,
  periodStartIso: string,
): Promise<{ email: string; atIso: string } | null> {
  const since = new Date(new Date(periodStartIso).getTime() - NEW_PURCHASE_EMAIL_GRACE_MS).toISOString();
  const { data, error } = await sb
    .from("messages")
    .select("content, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(HISTORY_PAGE);
  if (error) return null;
  for (const m of data ?? []) {
    const email = extractContactEmail(m.content);
    if (email) return { email, atIso: m.created_at };
  }
  return null;
}
