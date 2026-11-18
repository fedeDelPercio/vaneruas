import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { PAYMENT_NOTIFICATION_CATEGORY } from "@/lib/payments/register";
import { groupPendingPayments } from "@/lib/payments/grouping";

// ===========================================================================
// Conversaciones que necesitan intervención del equipo.
//
// Patrón portado del panel de Hábitat (ConversationList + human-notifications):
// una conversación necesita intervención si tiene notificaciones al equipo sin
// resolver (`agent_notifications.resolved_at IS NULL`). Acá, con un ajuste:
//
//   - Cualquier categoría que no sea `validacion_pago` cuenta: derivaciones del
//     agente, reclamos de certificado y las altas de Tiendup que no se pudieron
//     hacer solas (escalado_manual de sistema).
//   - `validacion_pago` cuenta solo si la conversación tiene un comprobante
//     realmente pendiente de revisar (status pending, sin retención por
//     título: esos esperan a la contacta, no al equipo). Hasta el 17/11/2026
//     esas notificaciones no se resolvían nunca y quedaron cientos abiertas de
//     pagos ya validados.
//
// Con el cliente del panel RLS aísla por client_slug. Todo se trae paginado y
// se cruza en memoria (nada de cientos de ids en un `.in()`).
// ===========================================================================

type Db = SupabaseClient<Database>;

/** Por qué una conversación necesita intervención. */
export interface InterventionInfo {
  /** Notificaciones abiertas que no son `validacion_pago` (derivaciones,
   *  reclamos, altas de Tiendup que no salieron solas). */
  derivations: number;
  /** Tiene una `validacion_pago` abierta con un comprobante pendiente. */
  payment: boolean;
}

/**
 * Conversaciones que necesitan intervención → por qué. Las claves del Map son
 * el mismo conjunto de siempre (`.has()` / `.size` sirven como antes).
 * Filtra por `client_slug` explícito además de RLS.
 */
export async function loadInterventionConversationIds(
  sb: Db,
  clientSlug: string,
): Promise<Map<string, InterventionInfo>> {
  const [openNotifs, pendingPays] = await Promise.all([
    fetchAllRows((from, to) =>
      sb
        .from("agent_notifications")
        .select("id, conversation_id, category")
        .eq("client_slug", clientSlug)
        .is("resolved_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      sb
        .from("payment_validations")
        .select("id, conversation_id")
        .eq("client_slug", clientSlug)
        .eq("status", "pending")
        .eq("awaiting_title", false)
        .not("conversation_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const withPending = new Set(
    pendingPays.map((p) => p.conversation_id).filter(Boolean) as string[],
  );
  const out = new Map<string, InterventionInfo>();
  for (const n of openNotifs) {
    if (!n.conversation_id) continue;
    const isPayment = n.category === PAYMENT_NOTIFICATION_CATEGORY;
    if (isPayment && !withPending.has(n.conversation_id)) continue;
    const info = out.get(n.conversation_id) ?? { derivations: 0, payment: false };
    if (isPayment) info.payment = true;
    else info.derivations += 1;
    out.set(n.conversation_id, info);
  }
  return out;
}

/**
 * Resuelve las notificaciones `validacion_pago` abiertas de una conversación
 * cuando ya no le queda ningún comprobante pendiente (la notificación solo
 * guarda la conversación, no el comprobante). Se llama al validar, rechazar o
 * descartar un comprobante. Best-effort: nunca lanza.
 */
export async function resolvePaymentNotificationsIfDone(
  sb: Db,
  conversationId: string,
  resolvedBy: string | null,
): Promise<void> {
  try {
    const { count, error } = await sb
      .from("payment_validations")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("status", "pending");
    if (error || (count ?? 0) > 0) return;
    await sb
      .from("agent_notifications")
      .update({ resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
      .eq("conversation_id", conversationId)
      .eq("category", PAYMENT_NOTIFICATION_CATEGORY)
      .is("resolved_at", null);
  } catch (err) {
    console.error("[interventions] no se pudieron resolver las notificaciones de pago:", err);
  }
}

/**
 * Conversaciones con derivaciones al equipo abiertas, SIN contar
 * `validacion_pago`. Lo usa /revision para marcar en la lista quién tiene una
 * intervención además del comprobante o título que se está revisando: con el
 * criterio de `loadInterventionConversationIds`, todo comprobante pendiente
 * contaría como intervención y el indicador no diría nada.
 *
 * Devuelve id de conversación → cantidad de notificaciones abiertas. Filtra
 * por `client_slug` explícito además de RLS.
 */
export async function loadOpenTeamNotificationCounts(
  sb: Db,
  clientSlug: string,
): Promise<Map<string, number>> {
  const rows = await fetchAllRows((from, to) =>
    sb
      .from("agent_notifications")
      .select("id, conversation_id")
      .eq("client_slug", clientSlug)
      .is("resolved_at", null)
      .neq("category", PAYMENT_NOTIFICATION_CATEGORY)
      .not("conversation_id", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const out = new Map<string, number>();
  for (const n of rows) {
    if (!n.conversation_id) continue;
    out.set(n.conversation_id, (out.get(n.conversation_id) ?? 0) + 1);
  }
  return out;
}

/** Qué tiene para aprobar una conversación. */
export interface PendingApprovalInfo {
  /** Comprobantes `pending` (incluidos los retenidos por título). */
  comprobantes: number;
  /** Títulos profesionales sin revisar. */
  titulos: number;
  /** Algún comprobante está retenido hasta validar el título. */
  awaitingTitle: boolean;
}

/**
 * Conversaciones con algo para aprobar → qué tienen: comprobantes `pending`
 * (incluidos los retenidos por título) y títulos profesionales sin revisar.
 * Es el mismo criterio que la cola de /revision (`buildReviewItems`). Lo usa
 * el filtro "Falta aprobar" de /wa y los pills de cada fila.
 *
 * Paginado y cruzado en memoria (nada de ids en un `.in()`), con `client_slug`
 * explícito además de RLS.
 */
export async function loadPendingApprovalConversationIds(
  sb: Db,
  clientSlug: string,
): Promise<Map<string, PendingApprovalInfo>> {
  const [pays, titles] = await Promise.all([
    fetchAllRows((from, to) =>
      sb
        .from("payment_validations")
        .select("id, conversation_id, awaiting_title, event_slug, status, amount, operation_number, created_at")
        .eq("client_slug", clientSlug)
        .eq("status", "pending")
        .not("conversation_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      sb
        .from("professional_titles")
        .select("id, conversation_id")
        .eq("client_slug", clientSlug)
        .eq("is_valid", false)
        .is("reviewed_at", null)
        .not("conversation_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const out = new Map<string, PendingApprovalInfo>();
  const entry = (id: string) => {
    let info = out.get(id);
    if (!info) {
      info = { comprobantes: 0, titulos: 0, awaitingTitle: false };
      out.set(id, info);
    }
    return info;
  };
  // Un comprobante por GRUPO (varias imágenes del mismo pago = uno, ver
  // src/lib/payments/grouping.ts).
  for (const g of groupPendingPayments(pays)) {
    const convId = g.canonical.conversation_id;
    if (!convId) continue;
    const info = entry(convId);
    info.comprobantes += 1;
    if (g.members.some((m) => m.awaiting_title)) info.awaitingTitle = true;
  }
  for (const t of titles) {
    if (t.conversation_id) entry(t.conversation_id).titulos += 1;
  }
  return out;
}
