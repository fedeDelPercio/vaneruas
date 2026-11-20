import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { deliverAssistantToWhatsApp } from "@/lib/whatsapp-delivery";
import { sendTeamNotificationAlert } from "@/lib/email/sender";
import { normalizeContactEmail } from "@/lib/contact-email";
import {
  enrollCourseByEmail,
  tiendupCourseIdForEvent,
  splitFullName,
  listEnrolled,
  listEnrolledChecked,
  fixDominioDeCorreo,
  listCustomersChecked,
  findCustomerByEmail,
  type CustomersListing,
} from "./client";
import { decideGrantAction } from "./customer-gate";
import {
  ACCESS_NOTICE_FAILED_SUMMARY,
  TIENDUP_ACCESS_MESSAGE,
  accessNoticeFailedReason,
  enrollmentPendingReason,
  enrollmentPendingSummary,
  notInTiendupError,
} from "./messages";

// ===========================================================================
// Alta en Tiendup de un comprobante validado.
//
// Es la lógica del botón "Dar acceso al curso" de Aprobaciones y del botón
// "Enviar a Tiendup" de la ficha, compartida con el alta automática
// (auto-enroll.ts). Antes de inscribir chequea el listado real de inscriptos
// del curso: si ya figura con este correo, solo se marca.
//
// Manual (pedido del equipo): inscribe DIRECTO, sin confirmación previa. No
// mira si la persona figura por nombre con otro correo ni si el correo es
// cliente de la tienda: si no lo es, Tiendup crea el cliente.
//
// Automático (auto-enroll.ts, nadie mira el caso):
//   - match por NOMBRE con otro correo → no inscribe (`name_conflict`);
//   - sin match → chequea que el correo exista como CLIENTE de la tienda
//     (GET /customers, customer-gate.ts): si no existe, o no se pudo verificar,
//     no inscribe (`not_in_tiendup` / `customer_check_failed`) y queda la
//     notificación "Alta en Tiendup pendiente".
//
// Además, el automático:
//   - exige un correo con formato válido (normalizeContactEmail);
//   - si el listado de inscriptos no se pudo leer completo, no inscribe.
// ===========================================================================

type Db = SupabaseClient<Database>;

export type GrantMode = "manual" | "auto";

export type GrantOutcome =
  | { kind: "not_found" }
  | { kind: "not_validated" }
  | { kind: "no_course" }
  | { kind: "no_email" }
  | { kind: "invalid_email" }
  | { kind: "listing_failed" }
  | {
      kind: "name_conflict";
      email: string;
      existing: { name: string; email: string | null };
    }
  | { kind: "already_enrolled"; email: string; emailFixed: boolean }
  | { kind: "enrolled"; email: string; emailFixed: boolean }
  | { kind: "enroll_failed"; error: string }
  /** Auto: el correo no existe como cliente de la tienda. No se inscribió. */
  | { kind: "not_in_tiendup"; email: string }
  /** Auto: no se pudo leer completo el listado de clientes. No se inscribió. */
  | { kind: "customer_check_failed"; email: string };

// Si el correo no aparece en un listado de clientes cacheado de más de 1 min,
// se relee una vez: quien se registró recién en la web no tiene que quedar
// frenada por el cache.
const CUSTOMERS_REFRESH_IF_OLDER_MS = 60_000;

async function loadCustomersFor(email: string): Promise<CustomersListing> {
  let listing = await listCustomersChecked();
  if (
    listing.complete &&
    !findCustomerByEmail(listing.customers, email) &&
    Date.now() - listing.fetchedAt > CUSTOMERS_REFRESH_IF_OLDER_MS
  ) {
    listing = await listCustomersChecked({ maxAgeMs: 0 });
  }
  return listing;
}

export interface GrantResult {
  outcome: GrantOutcome;
  /** Conversación del comprobante (para avisos y notificaciones). */
  conversationId: string | null;
}

/** ¿El resultado deja el acceso efectivo en Tiendup? */
export function grantSucceeded(o: GrantOutcome): boolean {
  return o.kind === "enrolled" || o.kind === "already_enrolled";
}

/**
 * Intenta dar el acceso al curso de un comprobante. No lanza: los errores de
 * Tiendup vuelven como `enroll_failed`. Si sale bien, marca el comprobante,
 * resuelve la notificación de alta pendiente y (salvo `notify: false`) le
 * avisa a la persona por WhatsApp (una vez por curso).
 */
export async function grantCourseAccess(
  paymentId: string,
  opts: {
    /** manual = inscribe directo (sin confirmaciones); auto = conservador. */
    mode: GrantMode;
    /**
     * false = no avisar a la persona por WhatsApp cuando el acceso queda dado
     * (la notificación de alta pendiente se resuelve igual). Default true.
     */
    notify?: boolean;
    sb?: Db;
  },
): Promise<GrantResult> {
  const sb = opts.sb ?? getSupabaseServerClient();
  const auto = opts.mode === "auto";
  const notify = opts.notify !== false;

  const { data: pay } = await sb
    .from("payment_validations")
    .select("id, status, event_slug, conversation_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!pay) return { outcome: { kind: "not_found" }, conversationId: null };
  const conversationId = pay.conversation_id ?? null;
  if (pay.status !== "validated") return { outcome: { kind: "not_validated" }, conversationId };

  const courseId = tiendupCourseIdForEvent(pay.event_slug);
  if (!courseId) return { outcome: { kind: "no_course" }, conversationId };

  const { data: conv } = conversationId
    ? await sb
        .from("conversations")
        .select("contact_email, display_name")
        .eq("id", conversationId)
        .maybeSingle()
    : { data: null };

  const rawEmail = conv?.contact_email?.trim();
  if (!rawEmail) return { outcome: { kind: "no_email" }, conversationId };
  if (auto && !normalizeContactEmail(rawEmail)) {
    return { outcome: { kind: "invalid_email" }, conversationId };
  }
  // Typos de dominio (".con" por ".com") se corrigen antes de buscar e inscribir:
  // si no, no matchean con el inscripto real y crean un cliente duplicado.
  const { email, fixed: emailFixed } = fixDominioDeCorreo(rawEmail);
  const fullName = conv?.display_name ?? null;

  // --- Chequeo previo contra el listado real de inscriptos de Tiendup ---
  let enrolled;
  if (auto) {
    const listing = await listEnrolledChecked(courseId);
    if (!listing.complete) return { outcome: { kind: "listing_failed" }, conversationId };
    enrolled = listing.enrolled;
  } else {
    enrolled = await listEnrolled(courseId);
  }
  const decision = await decideGrantAction({
    mode: opts.mode,
    enrolled,
    email,
    fullName,
    loadCustomers: () => loadCustomersFor(email),
  });

  let outcome: GrantOutcome;
  if (decision.action === "already_enrolled") {
    // Ya está inscripta con este correo: solo dejamos constancia en el panel.
    await markGranted(sb, paymentId);
    outcome = { kind: "already_enrolled", email, emailFixed };
  } else if (decision.action === "name_conflict") {
    const e = decision.existing;
    return {
      outcome: {
        kind: "name_conflict",
        email,
        existing: { name: [e.name, e.lastName].filter(Boolean).join(" "), email: e.email },
      },
      conversationId,
    };
  } else if (decision.action === "block") {
    // No crear clientes nuevos: el correo no existe en la tienda (o no se pudo
    // verificar). El alta automática se frena acá.
    if (decision.reason === "not_in_tiendup") {
      // Queda registrado para la ficha (prefijo NOT_IN_TIENDUP, messages.ts).
      await sb
        .from("payment_validations")
        .update({ course_access_error: notInTiendupError(), updated_at: new Date().toISOString() })
        .eq("id", paymentId);
      return { outcome: { kind: "not_in_tiendup", email }, conversationId };
    }
    return { outcome: { kind: "customer_check_failed", email }, conversationId };
  } else {
    const { name, lastName } = splitFullName(fullName);
    const result = await enrollCourseByEmail({ courseId, email, name, lastName });
    if (!result.ok) {
      await sb
        .from("payment_validations")
        .update({
          course_access_error: result.error ?? "error desconocido",
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentId);
      return {
        outcome: { kind: "enroll_failed", error: result.error ?? "error desconocido" },
        conversationId,
      };
    }
    await markGranted(sb, paymentId);
    outcome = { kind: "enrolled", email, emailFixed };
  }

  // Acceso efectivo: lo que sigue es best-effort y nunca cambia el resultado.
  if (conversationId) {
    await afterAccessGranted(sb, { paymentId, conversationId, eventSlug: pay.event_slug, notify });
  }
  return { outcome, conversationId };
}

/**
 * "Ya tiene acceso": marca sin inscribir en Tiendup. Resuelve la notificación
 * de alta pendiente pero NO avisa por WhatsApp: el equipo lo resolvió por
 * afuera y no sabemos si a la persona le llegó el correo de Tiendup.
 */
export async function markCourseAccessOnly(paymentId: string, sb: Db = getSupabaseServerClient()) {
  await markGranted(sb, paymentId);
  const { data: pay } = await sb
    .from("payment_validations")
    .select("conversation_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (pay?.conversation_id) {
    await resolveSystemNotification(sb, pay.conversation_id, enrollmentPendingReason(paymentId));
  }
}

async function markGranted(sb: Db, paymentId: string): Promise<void> {
  await sb
    .from("payment_validations")
    .update({
      course_access_granted_at: new Date().toISOString(),
      course_access_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);
}

async function afterAccessGranted(
  sb: Db,
  args: { paymentId: string; conversationId: string; eventSlug: string | null; notify: boolean },
): Promise<void> {
  try {
    await resolveSystemNotification(sb, args.conversationId, enrollmentPendingReason(args.paymentId));
  } catch (err) {
    console.error("[tiendup] no se pudo resolver la notificación de alta pendiente:", err);
  }
  if (!args.notify) return;
  try {
    await sendAccessNotice(sb, args);
  } catch (err) {
    console.error("[tiendup] no se pudo avisar el acceso por WhatsApp:", err);
  }
}

/**
 * Le avisa a la persona que el link del grupo le llegó al correo. Una sola vez
 * por curso: si ya le mandamos este texto después del primer comprobante de
 * ese evento, no se repite (pasa con quien pagó en dos transferencias, o si
 * el equipo vuelve a tocar "Dar acceso").
 *
 * Si el envío falla (típico: ventana de 24 h de WhatsApp vencida), se marca en
 * el comprobante (como el aviso de pago aprobado) y se abre una notificación
 * para que el equipo le avise a mano. No bloquea el alta.
 */
async function sendAccessNotice(
  sb: Db,
  args: { paymentId: string; conversationId: string; eventSlug: string | null },
): Promise<void> {
  let firstQuery = sb
    .from("payment_validations")
    .select("created_at")
    .eq("conversation_id", args.conversationId)
    .order("created_at", { ascending: true })
    .limit(1);
  firstQuery = args.eventSlug
    ? firstQuery.eq("event_slug", args.eventSlug)
    : firstQuery.eq("id", args.paymentId);
  const { data: first } = await firstQuery.maybeSingle();
  const since = first?.created_at ?? new Date(0).toISOString();

  const { data: already, error: alreadyErr } = await sb
    .from("messages")
    .select("id")
    .eq("conversation_id", args.conversationId)
    .eq("role", "assistant")
    .eq("content", TIENDUP_ACCESS_MESSAGE)
    .gte("created_at", since)
    .limit(1);
  // Si no se pudo leer, mejor no mandar: un aviso repetido confunde más que
  // uno que falta (el correo de Tiendup le llega igual).
  if (alreadyErr || already?.length) return;

  const { data: inserted } = await sb
    .from("messages")
    .insert({
      conversation_id: args.conversationId,
      role: "assistant",
      content: TIENDUP_ACCESS_MESSAGE,
    })
    .select("id")
    .single();
  await sb
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", args.conversationId);

  const delivery = await deliverAssistantToWhatsApp({
    conversationId: args.conversationId,
    messageId: inserted?.id,
    content: TIENDUP_ACCESS_MESSAGE,
  });
  if (delivery.status !== "failed") return;

  await sb
    .from("payment_validations")
    .update({
      delivery_failed: true,
      delivery_error: `Aviso de acceso a Tiendup: ${delivery.error ?? "error desconocido"}`,
    })
    .eq("id", args.paymentId);
  await openSystemNotification(sb, {
    conversationId: args.conversationId,
    reason: accessNoticeFailedReason(args.paymentId),
    summary: ACCESS_NOTICE_FAILED_SUMMARY,
    paymentId: args.paymentId,
  });
}

// --- Notificaciones de sistema (agent_notifications) ------------------------
//
// Categoría `escalado_manual`: la base compartida tiene un CHECK sobre
// `category` que no está en las migraciones, y una categoría nueva rompería el
// insert (y el email). La marca va en `reason` (ver messages.ts). Así aparecen
// en Derivaciones y en "Intervención" de /wa sin tocar el esquema.

const SYSTEM_CATEGORY = "escalado_manual";

/** Abre (o actualiza) la notificación de alta pendiente de un comprobante. */
export async function openEnrollmentPendingNotification(
  args: { conversationId: string; paymentId: string; motivo: string },
  sb: Db = getSupabaseServerClient(),
): Promise<void> {
  await openSystemNotification(sb, {
    conversationId: args.conversationId,
    reason: enrollmentPendingReason(args.paymentId),
    summary: enrollmentPendingSummary(args.motivo),
    paymentId: args.paymentId,
  });
}

/**
 * Una notificación abierta por caso: si ya hay una sin resolver con la misma
 * marca, solo se actualiza el motivo (y no se repite el email).
 */
async function openSystemNotification(
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
    console.error("[tiendup] no se pudo leer las notificaciones abiertas:", openErr.message);
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
    console.error("[tiendup] no se pudo registrar la notificación:", error.message);
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
    console.error("[tiendup] no se pudo enviar el email al equipo:", err);
  }
}

async function resolveSystemNotification(
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
