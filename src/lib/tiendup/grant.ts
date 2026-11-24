import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { deliverAssistantToWhatsApp } from "@/lib/whatsapp-delivery";
import { openSystemNotification, resolveSystemNotification } from "@/lib/system-notifications";
import { fixedTextVariants } from "@/lib/whatsapp-templates";
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
import { getTiendupAutoEnrollSetting } from "./auto-enroll-setting";
import {
  ACCESS_NOTICE_FAILED_SUMMARY,
  TIENDUP_ACCESS_MESSAGE,
  accessNoticeFailedReason,
  enrollmentPendingReason,
  enrollmentPendingSummary,
  isGaveUpError,
  isNameConflictError,
  isNotInTiendupError,
  nameConflictError,
  notInTiendupError,
  nextRetryError,
  parseRetryError,
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
//
// Fallos transitorios: quedan con un marcador RETRY_* en course_access_error y
// los retoma la cola del cron (retry-pending.ts), respetando el modo original.
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
  | {
      kind: "enroll_failed";
      error: string;
      /** Tiendup no respondió: se puede reintentar. */
      transient?: boolean;
      /** Quedó en la cola de reintentos del cron. */
      queued?: boolean;
    }
  /** Auto: el correo no existe como cliente de la tienda. No se inscribió. */
  | { kind: "not_in_tiendup"; email: string }
  /** Auto: no se pudo leer completo el listado de clientes. No se inscribió. */
  | { kind: "customer_check_failed"; email: string };

// Si el correo no aparece en un listado de clientes cacheado de más de 1 min,
// se relee una vez: quien se registró recién en la web no tiene que quedar
// frenada por el cache.
const CUSTOMERS_REFRESH_IF_OLDER_MS = 60_000;

// Tope para todas las llamadas a Tiendup de un alta inline: la función corta a
// los 60 s y después del alta todavía falta avisar por WhatsApp.
const GRANT_DEADLINE_MS = 35_000;

async function loadCustomersFor(email: string, deadlineAt: number): Promise<CustomersListing> {
  let listing = await listCustomersChecked({ deadlineAt });
  if (
    listing.complete &&
    !findCustomerByEmail(listing.customers, email) &&
    Date.now() - listing.fetchedAt > CUSTOMERS_REFRESH_IF_OLDER_MS
  ) {
    listing = await listCustomersChecked({ maxAgeMs: 0, deadlineAt });
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
    /**
     * Lo llama la cola del cron: un solo POST (reintenta la próxima corrida) y,
     * con el listado de inscriptos caído, no inscribe tampoco en manual.
     */
    fromQueue?: boolean;
    /** Tiempo máximo para las llamadas a Tiendup (default 35 s). */
    deadlineMs?: number;
  },
): Promise<GrantResult> {
  const sb = opts.sb ?? getSupabaseServerClient();
  const auto = opts.mode === "auto";
  const notify = opts.notify !== false;
  const fromQueue = opts.fromQueue === true;
  const deadlineAt = Date.now() + (opts.deadlineMs ?? GRANT_DEADLINE_MS);

  const { data: pay } = await sb
    .from("payment_validations")
    .select("id, status, event_slug, conversation_id, course_access_granted_at")
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

  // Un intento automático o de la cola pudo quedar viejo mientras el equipo daba el alta.
  if ((auto || fromQueue) && pay.course_access_granted_at) {
    await sb.from("payment_validations")
      .update({ course_access_error: null })
      .eq("id", paymentId)
      .eq("course_access_granted_at", pay.course_access_granted_at)
      .not("course_access_error", "is", null);
    await resolveSystemNotification(sb, null, enrollmentPendingReason(paymentId));
    return { outcome: { kind: "already_enrolled", email: conv?.contact_email ?? "", emailFixed: false }, conversationId };
  }

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
  // Marca el caso para la cola, con la intención de aviso del pedido original
  // (nextRetryError conserva el primer fallo mientras sea el mismo pedido).
  const readAccessState = () => sb.from("payment_validations")
    .select("course_access_granted_at, course_access_error")
    .eq("id", paymentId)
    .maybeSingle();

  const writeAccessError = async (text: string, nowIso: string) => {
    await sb.from("payment_validations")
      .update({ course_access_error: text, updated_at: nowIso })
      .eq("id", paymentId)
      .is("course_access_granted_at", null);
  };

  const saveTerminalError = async (text: string) => {
    const { data: current } = await readAccessState();
    if (!current || current.course_access_granted_at) return;
    await writeAccessError(text, new Date().toISOString());
  };

  const saveForRetry = async (text: string, queueOff = false) => {
    // Una caída de Tiendup no devuelve a la cola lo que ya espera a una persona.
    const { data: current } = await readAccessState();
    if (!current || current.course_access_granted_at) return;
    const stored = current.course_access_error;
    if (auto && (isNotInTiendupError(stored) || isNameConflictError(stored) || isGaveUpError(stored))) return;
    const nowIso = new Date().toISOString();
    const marker = nextRetryError({ stored, mode: opts.mode, notify, text, nowIso, queueOff });
    await writeAccessError(marker, nowIso);
  };

  let enrolled;
  if (auto || fromQueue) {
    const listing = await listEnrolledChecked(courseId, { deadlineAt });
    if (!listing.complete) {
      await saveForRetry("No se pudo leer el listado de inscriptos (Tiendup no respondió)");
      return { outcome: { kind: "listing_failed" }, conversationId };
    }
    enrolled = listing.enrolled;
  } else {
    enrolled = await listEnrolled(courseId, { deadlineAt });
  }
  const decision = await decideGrantAction({
    mode: opts.mode,
    enrolled,
    email,
    fullName,
    loadCustomers: () => loadCustomersFor(email, deadlineAt),
  });

  let outcome: GrantOutcome;
  if (decision.action === "already_enrolled") {
    // Ya está inscripta con este correo: solo dejamos constancia en el panel.
    await markGranted(sb, paymentId);
    outcome = { kind: "already_enrolled", email, emailFixed };
  } else if (decision.action === "name_conflict") {
    const e = decision.existing;
    // Lo resuelve una persona: la marca lo saca de la cola de reintentos.
    await saveTerminalError(nameConflictError());
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
      await saveTerminalError(notInTiendupError());
      return { outcome: { kind: "not_in_tiendup", email }, conversationId };
    }
    await saveForRetry("No se pudo verificar el correo en Tiendup (Tiendup no respondió)");
    return { outcome: { kind: "customer_check_failed", email }, conversationId };
  } else {
    const { name, lastName } = splitFullName(fullName);
    const result = await enrollCourseByEmail({
      courseId,
      email,
      name,
      lastName,
      deadlineAt,
      ...(fromQueue ? { retryDelaysMs: [] } : {}),
    });
    if (!result.ok) {
      const error = result.error ?? "error desconocido";
      const transient = result.transient === true;
      const queued = transient && (fromQueue || (await retryQueueEnabled()));
      // Sin marcador, un transitorio entraría a la cola como automático y con
      // aviso cuando se prenda: un pedido silencioso lo guarda igual.
      if (queued || (transient && !notify)) {
        await saveForRetry(error, !queued);
      } else {
        await saveTerminalError(error);
      }
      return { outcome: { kind: "enroll_failed", error, transient, queued }, conversationId };
    }
    await markGranted(sb, paymentId);
    outcome = { kind: "enrolled", email, emailFixed };
  }

  // Acceso efectivo: lo que sigue es best-effort y nunca cambia el resultado.
  if (conversationId && notify) {
    try {
      await sendAccessNotice(sb, { paymentId, conversationId, eventSlug: pay.event_slug });
    } catch (err) {
      console.error("[tiendup] no se pudo avisar el acceso por WhatsApp:", err);
    }
  }
  return { outcome, conversationId };
}

/** La cola corre solo con el alta automática prendida. Ante la duda, no promete. */
async function retryQueueEnabled(): Promise<boolean> {
  try {
    return (await getTiendupAutoEnrollSetting()).enabled && Boolean(process.env.TIENDUP_API_KEY);
  } catch {
    return false;
  }
}

/**
 * "Ya tiene acceso": marca sin inscribir en Tiendup. Resuelve la notificación
 * de alta pendiente pero NO avisa por WhatsApp: el equipo lo resolvió por
 * afuera y no sabemos si a la persona le llegó el correo de Tiendup.
 */
export async function markCourseAccessOnly(paymentId: string, sb: Db = getSupabaseServerClient()) {
  await markGranted(sb, paymentId);
}

async function markGranted(sb: Db, paymentId: string): Promise<void> {
  const { error } = await sb
    .from("payment_validations")
    .update({
      course_access_granted_at: new Date().toISOString(),
      course_access_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);
  if (error) throw error;
  try {
    await resolveSystemNotification(sb, null, enrollmentPendingReason(paymentId));
  } catch (err) {
    console.error("[tiendup] no se pudieron resolver los avisos de alta pendiente:", err);
  }
}

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
    .in("content", fixedTextVariants(TIENDUP_ACCESS_MESSAGE))
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

/** Abre (o actualiza) la notificación de alta pendiente de un comprobante. */
export async function openEnrollmentPendingNotification(
  args: { conversationId: string; paymentId: string; motivo: string; queued?: boolean },
  sb: Db = getSupabaseServerClient(),
): Promise<void> {
  const reason = enrollmentPendingReason(args.paymentId);
  const readAccess = () => sb
    .from("payment_validations")
    .select("course_access_granted_at, course_access_error")
    .eq("id", args.paymentId)
    .maybeSingle();

  const { data: before } = await readAccess();
  if (!before || before.course_access_granted_at) return;
  // Un intento puede haber respetado una marca terminal previa y no haber
  // dejado este comprobante en cola.
  if (args.queued && !parseRetryError(before.course_access_error)) return;
  await openSystemNotification(sb, {
    conversationId: args.conversationId,
    reason,
    summary: enrollmentPendingSummary(args.motivo, args.queued),
    paymentId: args.paymentId,
    stillPending: async () => {
      const { data } = await readAccess();
      return Boolean(data && !data.course_access_granted_at);
    },
  });
  // Si el alta y el insert se cruzaron, el aviso no puede quedar abierto.
  const { data: after } = await readAccess();
  if (after?.course_access_granted_at) {
    await resolveSystemNotification(sb, null, reason);
  }
}
