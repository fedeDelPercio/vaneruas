import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { clientEnv } from "@/lib/env";
import { normalizeContactEmail } from "@/lib/contact-email";
import { pendingReason, tiendupAutoEnrollEnabled, waitsForAccess } from "./auto-enroll";
import { tiendupCourseIdForEvent, tiendupMappedCourses } from "./client";
import { grantCourseAccess, openEnrollmentPendingNotification } from "./grant";
import { gaveUpError, isSilentAccessError } from "./messages";
import {
  RETRY_DEFAULT_MAX,
  planRetries,
  retryResultOf,
  runRetryPlan,
  type RetryAttemptResult,
  type RetryRow,
  type RetryRunSummary,
} from "./retry-policy";

// ===========================================================================
// Cola de reintentos del alta en Tiendup.
//
// Tiendup puede fallar varios minutos seguidos y antes nada reintentaba: el
// caso quedaba trabado hasta que alguien tocara el botón. Esto corre en el cron
// de cada minuto (GET /api/jobs/process), sin tabla nueva: el estado vive en
// course_access_error (marcadores RETRY_*, messages.ts) y updated_at.
//
//   - hasta `max` comprobantes por corrida, de a uno;
//   - al primer fallo transitorio corta la corrida (no martillar a Tiendup);
//   - cada comprobante, como mucho cada 2 minutos; a las 24 h del primer fallo
//     deja de reintentar y avisa al equipo;
//   - modo automático (nunca crea clientes), salvo que el último fallo venga de
//     un click del equipo (RETRY_MANUAL): ahí respeta ese pedido;
//   - un marcador _SILENT ("Enviar a Tiendup") reintenta sin avisar a la persona.
//
// Las decisiones son puras y están en retry-policy.ts.
// ===========================================================================

type Db = SupabaseClient<Database>;

const ROW_COLS =
  "id, conversation_id, event_slug, status, awaiting_title, course_access_granted_at, course_access_error, updated_at";
const MAX_ROWS = 1000;
const CONVERSATIONS_CHUNK = 100;
// La corrida no arranca otro intento pasado este tiempo.
const RUN_BUDGET_MS = 120_000;
// Tiempo máximo de Tiendup por comprobante dentro del cron.
const QUEUE_GRANT_DEADLINE_MS = 60_000;
const GAVE_UP_REASON =
  "Tiendup no respondió durante 24 h y se dejó de reintentar solo";

/** Correos de las conversaciones, en tandas para no pasarse del largo de URL. */
async function loadEmails(sb: Db, slug: string, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += CONVERSATIONS_CHUNK) {
    const { data, error } = await sb
      .from("conversations")
      .select("id, contact_email")
      .eq("client_slug", slug)
      .in("id", ids.slice(i, i + CONVERSATIONS_CHUNK));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) out.set(c.id, c.contact_email);
  }
  return out;
}

/**
 * Toma el comprobante moviendo updated_at solo si nadie lo tocó desde que se
 * leyó: dos corridas superpuestas no intentan el mismo.
 */
async function claim(sb: Db, slug: string, row: RetryRow, nowIso: string): Promise<boolean> {
  const { data, error } = await sb
    .from("payment_validations")
    .update({ updated_at: nowIso })
    .eq("id", row.id)
    .eq("client_slug", slug)
    .eq("updated_at", row.updated_at)
    .is("course_access_granted_at", null)
    .select("id");
  return !error && Boolean(data?.length);
}

async function giveUp(sb: Db, slug: string, row: RetryRow, text: string, nowIso: string): Promise<void> {
  const { data } = await sb
    .from("payment_validations")
    .update({
      course_access_error: gaveUpError(text, isSilentAccessError(row.course_access_error)),
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .eq("client_slug", slug)
    .eq("updated_at", row.updated_at)
    .is("course_access_granted_at", null)
    .select("id");
  // Solo quien hizo la transición avisa: una vez por comprobante.
  if (data?.length && row.conversation_id) {
    await openEnrollmentPendingNotification(
      { conversationId: row.conversation_id, paymentId: row.id, motivo: GAVE_UP_REASON },
      sb,
    );
  }
}

export async function retryPendingEnrollments(args: {
  sb: Db;
  max?: number;
  now?: () => number;
}): Promise<RetryRunSummary | null> {
  const { sb } = args;
  const now = args.now ?? Date.now;
  if (!process.env.TIENDUP_API_KEY) return null;
  if (!(await tiendupAutoEnrollEnabled()).enabled) return null;

  const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;
  const startedAt = now();
  const { data, error } = await sb
    .from("payment_validations")
    .select(ROW_COLS)
    .eq("client_slug", slug)
    .eq("status", "validated")
    .eq("awaiting_title", false)
    .is("course_access_granted_at", null)
    .in("event_slug", tiendupMappedCourses().map((c) => c.eventSlug))
    .order("updated_at", { ascending: true })
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as RetryRow[];
  if (!rows.length) return { attempted: 0, ok: 0, pending: 0, tripped: false };

  const convIds = [...new Set(rows.map((r) => r.conversation_id).filter((id): id is string => Boolean(id)))];
  const emails = await loadEmails(sb, slug, convIds);
  const plan = planRetries(rows, {
    now: startedAt,
    waitsForAccess: (r) => waitsForAccess(r) && tiendupCourseIdForEvent(r.event_slug) !== null,
    hasValidEmail: (r) =>
      Boolean(r.conversation_id && normalizeContactEmail(emails.get(r.conversation_id))),
  });

  for (const g of plan.giveUp) {
    try {
      await giveUp(sb, slug, g.row, g.text, new Date(now()).toISOString());
    } catch (err) {
      console.error(`[tiendup] reintentos: no se pudo cerrar el pago ${g.row.id}:`, err);
    }
  }

  const summary = await runRetryPlan({
    items: plan.retry,
    max: args.max ?? RETRY_DEFAULT_MAX,
    waiting: plan.waiting,
    shouldStop: () => now() - startedAt > RUN_BUDGET_MS,
    attempt: async ({ row, mode, notify }): Promise<RetryAttemptResult> => {
      if (!(await claim(sb, slug, row, new Date(now()).toISOString()))) return "skipped";
      try {
        const { outcome } = await grantCourseAccess(row.id, {
          mode,
          notify: notify !== false,
          sb,
          fromQueue: true,
          deadlineMs: QUEUE_GRANT_DEADLINE_MS,
        });
        const result = retryResultOf(outcome);
        if (result === "failed" && row.conversation_id) {
          // Salió de la cola por algo que necesita a una persona.
          const motivo = pendingReason(outcome);
          if (motivo) {
            await openEnrollmentPendingNotification(
              { conversationId: row.conversation_id, paymentId: row.id, motivo },
              sb,
            );
          }
        }
        return result;
      } catch (err) {
        console.error(`[tiendup] reintentos: falló el pago ${row.id}:`, err);
        return "failed";
      }
    },
  });

  if (summary.attempted || summary.pending || plan.giveUp.length) {
    console.log(
      `[tiendup] reintentos: ${summary.attempted} intentados, ok ${summary.ok}, pendientes ${summary.pending}, corte por Tiendup caído: ${summary.tripped ? "sí" : "no"}`,
    );
  }
  return summary;
}
