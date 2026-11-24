import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { needsCourseAccess } from "@/lib/payments/revision-card";
import {
  grantCourseAccess,
  grantSucceeded,
  openEnrollmentPendingNotification,
  type GrantOutcome,
} from "./grant";
import { retryResultOf } from "./retry-policy";
import type { AutoEnrollResolution } from "./auto-enroll-flag";
import { getTiendupAutoEnrollSetting } from "./auto-enroll-setting";
import { isSilentAccessError, parseRetryError } from "./messages";

// ===========================================================================
// Alta automática en Tiendup.
//
// Cuando un comprobante de masterclass queda validado, sin retención por
// título (el gate ya pasó: título aprobado, clienta registrada o aprobación
// forzada por el equipo) y tenemos un correo válido, se da de alta en Tiendup
// con la MISMA lógica que el botón "Dar acceso al curso" (grantCourseAccess,
// en modo automático: nunca fuerza, exige correo válido y listado completo).
// Nunca crea un cliente nuevo en Tiendup: si el correo no existe como cliente
// de la tienda (o no se pudo verificar), no inscribe y avisa al equipo (ver
// customer-gate.ts).
//
// Disparadores:
//   - al validar un comprobante (PATCH /api/payments/[id], también desde /wa);
//   - al validarse el título cuando ya había un pago validado;
//   - al capturarse el correo de la contacta en el worker.
//
// Lo que no se puede dar de alta solo abre UNA notificación al equipo con el
// motivo (Derivaciones y "Intervención" en /wa). El botón de Aprobaciones →
// Falta acceso queda como respaldo. Nunca lanza: quien la llama no puede
// fallar por Tiendup.
//
// Flag: interruptor del panel (/payments → Falta acceso), guardado en
// agent_settings.auto_send.tiendup_auto_enroll. Si no hay valor en la base,
// manda la env TIENDUP_AUTO_ENROLL ("false", "0", "off" o "no" apaga); si
// tampoco está, prendido. Se lee en cada ejecución (sin cache).
// ===========================================================================

type Db = SupabaseClient<Database>;

/** ¿Está prendida el alta automática? (base > env > prendido) y de dónde sale. */
export async function tiendupAutoEnrollEnabled(): Promise<AutoEnrollResolution> {
  const { enabled, source } = await getTiendupAutoEnrollSetting();
  return { enabled, source };
}

interface PaymentRow {
  id: string;
  conversation_id: string | null;
  event_slug: string | null;
  status: string;
  awaiting_title: boolean;
  course_access_granted_at: string | null;
  course_access_error?: string | null;
}

const PAYMENT_COLS =
  "id, conversation_id, event_slug, status, awaiting_title, course_access_granted_at, course_access_error";

/**
 * ¿Este comprobante está esperando acceso? Mismo criterio que la pestaña
 * "Falta acceso" de Aprobaciones: masterclass con el acceso vigente, pago
 * validado y acceso sin dar. Además, que no esté retenido por el título.
 */
export function waitsForAccess(p: PaymentRow): boolean {
  return !p.awaiting_title && needsCourseAccess(p.event_slug, p.status, p.course_access_granted_at);
}

/** Motivo legible para el equipo, o null si no corresponde avisar. */
export function pendingReason(o: GrantOutcome): string | null {
  switch (o.kind) {
    case "no_email":
      return "todavía no tenemos su correo (se le pidió al confirmar el pago)";
    case "invalid_email":
      return "el correo que dejó no tiene un formato válido";
    case "name_conflict":
      return "figura inscripta en Tiendup con otro correo, hay que confirmar cuál es el correcto";
    case "listing_failed":
      return "no se pudo leer el listado de inscriptos de Tiendup para descartar un duplicado";
    case "enroll_failed":
      return "Tiendup devolvió un error al inscribir";
    case "not_in_tiendup":
      return "el mail no figura en Tiendup (no es cliente de la tienda ni está inscripta en el curso), inscribirla crearía un cliente nuevo. Confirmá el correo con ella antes de dar el acceso";
    case "customer_check_failed":
      return "no se pudo verificar el correo en Tiendup (no se pudo leer el listado de clientes), por eso no se inscribió";
    case "no_course":
      return "el curso de este evento no está cargado en Tiendup (falta el mapeo)";
    default:
      return null;
  }
}

async function enrollOne(sb: Db, p: PaymentRow, trigger: string): Promise<void> {
  // Pedido manual en cola: lo retoma retry-pending.ts en modo manual. Un intento
  // automático acá podría pisar esa marca con un "no figura".
  if (parseRetryError(p.course_access_error)?.kind === "manual") return;
  try {
    // Un pedido silencioso ("Enviar a Tiendup") sigue sin avisar a la persona.
    const { outcome } = await grantCourseAccess(p.id, {
      mode: "auto",
      notify: !isSilentAccessError(p.course_access_error),
      sb,
    });
    if (grantSucceeded(outcome)) {
      console.log(`[tiendup] alta automática ok (${trigger}): pago ${p.id}`);
      return;
    }
    const motivo = pendingReason(outcome);
    console.log(`[tiendup] alta automática pendiente (${trigger}): pago ${p.id}, ${outcome.kind}`);
    if (motivo && p.conversation_id) {
      await openEnrollmentPendingNotification(
        { conversationId: p.conversation_id, paymentId: p.id, motivo, queued: retryResultOf(outcome) === "transient" },
        sb,
      );
    }
  } catch (err) {
    console.error(`[tiendup] alta automática falló (${trigger}): pago ${p.id}:`, err);
    if (p.conversation_id) {
      try {
        await openEnrollmentPendingNotification(
          {
            conversationId: p.conversation_id,
            paymentId: p.id,
            motivo: "falló el alta automática por un error inesperado",
          },
          sb,
        );
      } catch {
        // Ya quedó en el log; el comprobante sigue en "Falta acceso".
      }
    }
  }
}

/** Alta automática de un comprobante puntual (al validarlo). */
export async function autoEnrollPayment(
  paymentId: string,
  opts: { trigger: string; sb?: Db },
): Promise<void> {
  if (!(await tiendupAutoEnrollEnabled()).enabled) return;
  try {
    const sb = opts.sb ?? getSupabaseServerClient();
    const { data } = await sb
      .from("payment_validations")
      .select(PAYMENT_COLS)
      .eq("id", paymentId)
      .maybeSingle();
    const p = data as PaymentRow | null;
    if (!p || !waitsForAccess(p)) return;
    await enrollOne(sb, p, opts.trigger);
  } catch (err) {
    console.error("[tiendup] alta automática: no se pudo leer el comprobante:", err);
  }
}

/**
 * Alta automática de todo lo que una conversación tenga esperando acceso (al
 * validarse el título o al llegar el correo).
 */
export async function autoEnrollConversation(
  conversationId: string,
  opts: { trigger: string; sb?: Db },
): Promise<void> {
  if (!(await tiendupAutoEnrollEnabled()).enabled) return;
  try {
    const sb = opts.sb ?? getSupabaseServerClient();
    const { data } = await sb
      .from("payment_validations")
      .select(PAYMENT_COLS)
      .eq("conversation_id", conversationId)
      .eq("status", "validated")
      .is("course_access_granted_at", null)
      .order("created_at", { ascending: true });
    const rows = ((data ?? []) as PaymentRow[]).filter(waitsForAccess);
    for (const p of rows) await enrollOne(sb, p, opts.trigger);
  } catch (err) {
    console.error("[tiendup] alta automática: no se pudo leer la conversación:", err);
  }
}
