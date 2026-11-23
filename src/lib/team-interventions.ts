// ===========================================================================
// Intervenciones del equipo que se abren y se cierran solas.
//
// Patrón portado de Hábitat (src/lib/human-notifications.ts + human-reply.ts):
// cuando una persona del equipo le responde a la contacta, las intervenciones
// abiertas de esa conversación se resuelven solas, igual que "Marcar atendida".
// Y al revés: si la conversación está en modo Humano (IA en pausa) y la
// contacta escribe, se abre una intervención para que alguien le conteste.
//
// Qué se resuelve al responder (decisión D-36):
//   - Sí: derivaciones del agente (fuera_de_conocimiento, escalado_manual y las
//     categorías viejas) y la "humano_sin_respuesta" de este módulo.
//   - No: `validacion_pago` (se cierra al validar, rechazar o descartar el
//     comprobante), `reclamo_certificado` (tiene su cola en /certificados y
//     contestar no es resolver el certificado) y las de sistema de Tiendup
//     (`reason` tiendup_*, se cierran cuando el alta sale bien).
//
// Sin "server-only": lo usa también el importador de mensajes del equipo, que
// corre desde scripts/ con service role. Por eso el client_slug va SIEMPRE
// explícito en cada query (con el cliente del panel además lo aísla RLS).
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { APPROVAL_NOTICE_FAILED_PREFIX } from "./payments/messages";
import { SYSTEM_NOTIFICATION_REASON_LIKE } from "./tiendup/messages";

// El cliente tipado del panel y el de service role de los scripts no comparten
// el genérico de Database: se acepta cualquiera de los dos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>;

/** Marca en `agent_notifications.reason` de "la contacta escribió con la IA en pausa". */
export const HUMAN_WAITING_REASON = "humano_sin_respuesta";
/** Categoría existente (el CHECK de la base no admite categorías nuevas sin migración). */
export const HUMAN_WAITING_CATEGORY = "escalado_manual";
export const HUMAN_WAITING_SUMMARY =
  "La contacta escribió con la IA en pausa (modo Humano): respondele desde el panel o la app";
/** Etiqueta corta para carteles y listas. */
export const HUMAN_WAITING_LABEL = "Escribió con la IA en pausa";

/** Categorías que contestar en el chat NO resuelve (tienen su propio cierre). */
export const NOT_AUTO_RESOLVED_CATEGORIES = ["validacion_pago", "reclamo_certificado"] as const;

const NOT_IN_CATEGORIES = `(${NOT_AUTO_RESOLVED_CATEGORIES.join(",")})`;
/** Filtro PostgREST: fuera las de sistema de Tiendup. */
const NOT_TIENDUP = `reason.is.null,reason.not.like.${SYSTEM_NOTIFICATION_REASON_LIKE}`;

/**
 * Filtro PostgREST (para `.or()`) de las notificaciones que son derivaciones
 * DEL AGENTE: excluye las de sistema (Tiendup, avisos de pago y "humano_sin_respuesta"). Lo usa
 * el agente para saber si ya derivó y para no deduplicar una derivación real
 * contra una notificación de sistema de la misma categoría.
 */
export const AGENT_HANDOFF_FILTER =
  `reason.is.null,and(reason.not.like.${SYSTEM_NOTIFICATION_REASON_LIKE},reason.not.like.${APPROVAL_NOTICE_FAILED_PREFIX}*,reason.neq.${HUMAN_WAITING_REASON})`;

export interface ResolveResult {
  resolved: number;
  error: string | null;
}

/**
 * Resuelve las intervenciones abiertas de una conversación porque el equipo
 * respondió. Misma mutación que "Marcar atendida": solo `resolved_at` y
 * `resolved_by`. No toca el modo de la conversación ni llama a GHL.
 *
 * @param before  Si viene, solo resuelve las creadas ANTES de ese momento (un
 *                mensaje importado de GHL no puede cerrar una derivación que
 *                se abrió después de que la persona escribió).
 */
export async function resolveTeamInterventions(
  db: AnyDb,
  args: {
    conversationId: string;
    clientSlug: string;
    resolvedBy: string | null;
    before?: string | null;
    now?: Date;
  },
): Promise<ResolveResult> {
  try {
    let q = db
      .from("agent_notifications")
      .update({
        resolved_at: (args.now ?? new Date()).toISOString(),
        resolved_by: args.resolvedBy,
      })
      .eq("conversation_id", args.conversationId)
      .eq("client_slug", args.clientSlug)
      .is("resolved_at", null)
      .not("category", "in", NOT_IN_CATEGORIES)
      .or(NOT_TIENDUP);
    if (args.before) q = q.lt("created_at", args.before);
    const { data, error } = await q.select("id");
    if (error) return { resolved: 0, error: error.message };
    return { resolved: (data ?? []).length, error: null };
  } catch (err) {
    return { resolved: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Abre la intervención "humano_sin_respuesta" si la conversación no tiene ya
 * una intervención abierta que se cierre respondiendo (una sola por
 * conversación). Devuelve `opened: true` solo si insertó una nueva: el caller
 * manda el email al equipo únicamente en ese caso.
 */
export async function openHumanWaitingIntervention(
  db: AnyDb,
  args: { conversationId: string; clientSlug: string },
): Promise<{ opened: boolean; error: string | null }> {
  try {
    const { data: open, error: openErr } = await db
      .from("agent_notifications")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("client_slug", args.clientSlug)
      .is("resolved_at", null)
      .not("category", "in", NOT_IN_CATEGORIES)
      .or(NOT_TIENDUP)
      .limit(1);
    if (openErr) return { opened: false, error: openErr.message };
    if ((open ?? []).length > 0) return { opened: false, error: null };

    const { error } = await db.from("agent_notifications").insert({
      conversation_id: args.conversationId,
      client_slug: args.clientSlug,
      category: HUMAN_WAITING_CATEGORY,
      reason: HUMAN_WAITING_REASON,
      summary: HUMAN_WAITING_SUMMARY,
    });
    if (error) return { opened: false, error: error.message };
    return { opened: true, error: null };
  } catch (err) {
    return { opened: false, error: err instanceof Error ? err.message : String(err) };
  }
}
