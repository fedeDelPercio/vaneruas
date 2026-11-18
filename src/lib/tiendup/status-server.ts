import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { normalizeContactEmail } from "@/lib/contact-email";
import { eventBySlug } from "@/lib/payments/event-match";
import { fixDominioDeCorreo, listEnrolledChecked, tiendupCourseIdForEvent } from "./client";
import type { TiendupEnrolled } from "./match";
import {
  decideTiendupStatus,
  paymentsWithEnrollAttempt,
  type TiendupCourseStatus,
  type TiendupStatusResponse,
} from "./status";

// ===========================================================================
// Estado en vivo del acceso a Tiendup de una conversación (solo lectura, solo
// GET a Tiendup). Lo sirve GET /api/wa/tiendup-status/[conversationId] para el
// bloque "Tiendup" de la ficha; la decisión pura está en status.ts.
//
// Reutilizable: `loadTiendupStatus` y `getEnrolledListing` son lo que usaría
// una regla futura de "bloquear el alta si el correo no figura en Tiendup"
// (ver D-67). Hoy el alta no los llama.
// ===========================================================================

type Db = SupabaseClient<Database>;

type Listing = { enrolled: TiendupEnrolled[]; complete: boolean };

// Cache en memoria del server, por curso: el listado de inscriptos son varias
// páginas y la ficha se abre seguido. 5 min si vino completo; si vino cortado
// o falló, 1 min (para no martillar a Tiendup mientras está caído, pero
// reintentar pronto). Vive por instancia (en Vercel cada lambda tiene el suyo).
const TTL_OK_MS = 5 * 60_000;
const TTL_FAIL_MS = 60_000;
const cache = new Map<number, { at: number; value: Listing }>();
const inflight = new Map<number, Promise<Listing>>();

/**
 * Listado de inscriptos de un curso, con cache. null si no hay
 * `TIENDUP_API_KEY` (el estado queda `unavailable`).
 */
export async function getEnrolledListing(courseId: number): Promise<Listing | null> {
  if (!process.env.TIENDUP_API_KEY) return null;
  const hit = cache.get(courseId);
  if (hit && Date.now() - hit.at < (hit.value.complete ? TTL_OK_MS : TTL_FAIL_MS)) return hit.value;
  const running = inflight.get(courseId);
  if (running) return running;
  const p = listEnrolledChecked(courseId)
    .then((value) => {
      cache.set(courseId, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(courseId));
  inflight.set(courseId, p);
  return p;
}

/**
 * Estado de Tiendup por curso para una conversación. `show: false` si no tiene
 * correo con formato válido o si nunca hubo un intento de alta (acceso
 * marcado, error guardado o notificación `tiendup_*` de un comprobante suyo).
 * null = la conversación no existe (para este cliente).
 */
export async function loadTiendupStatus(
  sb: Db,
  conversationId: string,
  clientSlug: string,
): Promise<TiendupStatusResponse | null> {
  const [convRes, payRes, notifRes] = await Promise.all([
    sb
      .from("conversations")
      .select("id, contact_email, display_name")
      .eq("id", conversationId)
      .eq("client_slug", clientSlug)
      .maybeSingle(),
    sb
      .from("payment_validations")
      .select("id, event_slug, course_access_granted_at, course_access_error, updated_at, created_at")
      .eq("conversation_id", conversationId)
      .eq("client_slug", clientSlug)
      .eq("status", "validated")
      .order("created_at", { ascending: false }),
    sb
      .from("agent_notifications")
      .select("reason")
      .eq("conversation_id", conversationId)
      .eq("client_slug", clientSlug)
      .like("reason", "tiendup_%")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const failed = [convRes, payRes, notifRes].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const conv = convRes.data;
  if (!conv) return null;

  const valid = normalizeContactEmail(conv.contact_email);
  if (!valid) return { show: false, courses: [] };
  // Mismo correo que usa el alta (grant.ts): con el typo de dominio corregido.
  const email = fixDominioDeCorreo(valid).email;

  const payments = payRes.data ?? [];
  const attempted = paymentsWithEnrollAttempt({
    payments,
    notificationReasons: (notifRes.data ?? []).map((n) => n.reason),
  });
  if (!attempted.size) return { show: false, courses: [] };

  // Cursos de los comprobantes validados con intento de alta.
  const byCourse = new Map<number, typeof payments>();
  for (const p of payments) {
    if (!attempted.has(p.id)) continue;
    const courseId = tiendupCourseIdForEvent(p.event_slug);
    if (!courseId) continue;
    const arr = byCourse.get(courseId) ?? [];
    arr.push(p);
    byCourse.set(courseId, arr);
  }
  if (!byCourse.size) return { show: false, courses: [] };

  const courses: TiendupCourseStatus[] = await Promise.all(
    Array.from(byCourse.entries()).map(async ([courseId, pays]) => {
      // Error del último intento: solo si ningún comprobante de ese curso
      // quedó con el acceso marcado (markGranted limpia el error).
      const granted = pays.some((p) => p.course_access_granted_at);
      const lastError = granted
        ? null
        : pays
            .slice()
            .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))
            .map((p) => p.course_access_error?.trim() || null)
            .find(Boolean) ?? null;
      const listing = await getEnrolledListing(courseId);
      const decided = decideTiendupStatus({ listing, email, fullName: conv.display_name, lastError });
      return {
        courseId,
        title: eventBySlug(pays[0]!.event_slug)?.label ?? `Curso ${courseId}`,
        ...decided,
      };
    }),
  );
  return { show: true, courses };
}
