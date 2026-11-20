import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import type { ProfileRole } from "@/lib/supabase/types";
import { normalizeContactEmail } from "@/lib/contact-email";
import { grantCourseAccess } from "@/lib/tiendup/grant";
import { tiendupCourseIdForEvent } from "@/lib/tiendup/client";
import { invalidateEnrolledListing } from "@/lib/tiendup/status-server";
import { pickEnrollablePayment } from "@/lib/tiendup/status";
import { manualEmailNote } from "@/lib/tiendup/messages";

export const dynamic = "force-dynamic";
// El alta reintenta errores transitorios de Tiendup (hasta 3 intentos).
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// POST /api/wa/contact/[conversationId]/email
//
// Campo de correo del bloque "Acceso a Tiendup" de la ficha (/wa y /revision).
// Body: { email, enroll?, profileId }. (`confirmNewCustomer` se acepta por
// compatibilidad y se ignora.)
//
// 1. Guarda `conversations.contact_email` = email. SÍ pisa el que hubiera: es
//    una corrección manual del equipo (no aplica keep_and_note de
//    decideContactEmailUpdate, que es para lo que llega por el chat). Deja una
//    nota de sistema "Mail corregido por el equipo (<perfil>): <antes> → <nuevo>".
//    No se empuja a GHL.
// 2. Con enroll: true, da el alta con la MISMA lógica del botón "Dar acceso al
//    curso" (grantCourseAccess, modo manual) sobre el pago aprobado más
//    reciente con curso mapeado:
//      - inscribe DIRECTO, sin confirmación previa: no mira si la persona
//        figura por nombre con otro correo ni si el correo es cliente de la
//        tienda (si no lo es, Tiendup crea el cliente). Nunca devuelve 409 de
//        confirmación;
//      - si ya figura en el curso con este correo, solo se marca;
//      - NO le manda nada a la persona por WhatsApp: notify: false. (Tiendup
//        puede mandar su propio mail de bienvenida al inscribir.)
//    Si sale bien, resuelve la notificación tiendup_alta_pendiente_<pago>
//    (grantCourseAccess) e invalida el cache del listado de ese curso para que
//    la ficha muestre el estado nuevo.
//
// Auth (fase 1, sin auth real): como el resto del panel, el perfil activo
// viaja desde el navegador y el rol se lee de la base. Mismos roles que /wa.
// ===========================================================================

const ALLOWED_ROLES: ProfileRole[] = ["dev", "client", "asesor"];

const bodySchema = z.object({
  email: z.string().max(320),
  enroll: z.boolean().optional(),
  /** Compatibilidad: se ignora (el alta manual no pide confirmación). */
  confirmNewCustomer: z.boolean().optional(),
  profileId: z.string().uuid(),
});

export interface SaveEmailResponse {
  ok: boolean;
  email?: string;
  /** Solo con enroll: true. */
  enrolled?: boolean;
  alreadyEnrolled?: boolean;
  /** El alta usó el correo con el dominio corregido (gmail.con → gmail.com). */
  enrolledEmail?: string;
  error?: string;
}

function reply(body: SaveEmailResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) {
    return reply({ ok: false, error: "Conversación inválida" }, 400);
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return reply({ ok: false, error: "Pedido inválido ({ email, profileId })" }, 400);
  }
  const { enroll = false, profileId } = parsed.data;
  const email = normalizeContactEmail(parsed.data.email);
  if (!email) return reply({ ok: false, error: "Mail inválido" }, 400);

  const sb = getSupabaseServerClient();
  const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;

  const { data: profile } = await sb
    .from("profiles")
    .select("name, role")
    .eq("id", profileId)
    .eq("client_slug", slug)
    .maybeSingle();
  if (!profile || !ALLOWED_ROLES.includes(profile.role as ProfileRole)) {
    return reply({ ok: false, error: "Tu perfil no puede cambiar el mail" }, 403);
  }

  const { data: conv, error: convErr } = await sb
    .from("conversations")
    .select("id, contact_email")
    .eq("id", conversationId)
    .eq("client_slug", slug)
    .maybeSingle();
  if (convErr) return reply({ ok: false, error: convErr.message }, 500);
  if (!conv) return reply({ ok: false, error: "Conversación no encontrada" }, 404);

  // --- 1. Guardar el correo (pisa: corrección manual) ---
  const previous = conv.contact_email?.trim() || null;
  if (previous?.toLowerCase() !== email) {
    const { error: updErr } = await sb
      .from("conversations")
      .update({ contact_email: email })
      .eq("id", conversationId)
      .eq("client_slug", slug);
    if (updErr) return reply({ ok: false, error: updErr.message }, 500);
    const { error: noteErr } = await sb.from("messages").insert({
      conversation_id: conversationId,
      client_slug: slug,
      role: "system",
      content: manualEmailNote(profile.name, previous, email),
    });
    if (noteErr) console.error("[wa/email] no se pudo registrar la nota del cambio de mail:", noteErr.message);
  }
  if (!enroll) return reply({ ok: true, email });

  // --- 2. Alta en Tiendup ---
  const { data: pays, error: payErr } = await sb
    .from("payment_validations")
    .select("id, status, event_slug, validation_note, created_at")
    .eq("conversation_id", conversationId)
    .eq("client_slug", slug)
    .eq("status", "validated");
  if (payErr) return reply({ ok: false, email, error: payErr.message }, 500);
  const pay = pickEnrollablePayment(pays ?? [], (s) => tiendupCourseIdForEvent(s) !== null);
  if (!pay) return reply({ ok: false, email, enrolled: false, error: "Sin pago aprobado" }, 409);

  const { outcome: o } = await grantCourseAccess(pay.id, {
    mode: "manual",
    notify: false,
    sb,
  });

  switch (o.kind) {
    case "enrolled":
    case "already_enrolled": {
      const courseId = tiendupCourseIdForEvent(pay.event_slug);
      if (courseId) invalidateEnrolledListing(courseId);
      return reply({
        ok: true,
        email,
        enrolled: true,
        alreadyEnrolled: o.kind === "already_enrolled",
        enrolledEmail: o.email,
      });
    }
    case "enroll_failed":
      return reply({ ok: false, email, enrolled: false, error: o.error || "No se pudo dar el acceso" }, 502);
    case "not_validated":
      return reply({ ok: false, email, enrolled: false, error: "Sin pago aprobado" }, 409);
    case "no_course":
      return reply({ ok: false, email, enrolled: false, error: "El evento no tiene curso en Tiendup" }, 409);
    case "not_found":
      return reply({ ok: false, email, enrolled: false, error: "No se encontró el comprobante" }, 404);
    case "no_email":
    case "invalid_email":
      return reply({ ok: false, email, enrolled: false, error: "Mail inválido" }, 400);
    case "name_conflict":
    case "listing_failed":
    case "not_in_tiendup":
    case "customer_check_failed":
      // Solo pasan en modo automático; acá no deberían llegar.
      return reply({ ok: false, email, enrolled: false, error: "No se pudo dar el acceso" }, 502);
  }
}
