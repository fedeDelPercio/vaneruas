import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  enrollCourseByEmail,
  tiendupCourseIdForEvent,
  splitFullName,
} from "@/lib/tiendup/client";

export const dynamic = "force-dynamic";

// ===========================================================================
// POST /api/payments/[id]/grant-access
//
// Da acceso al curso (Tiendup) para un comprobante de masterclass ya validado.
// Inscribe a la persona por su email (crea el cliente en Tiendup si no existe).
// Fase 1: lo dispara el equipo a mano desde Aprobaciones. Guarda el resultado en
// el comprobante (course_access_granted_at / course_access_error).
// ===========================================================================

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getSupabaseServerClient();

  const { data: pay } = await sb
    .from("payment_validations")
    .select("id, status, event_slug, conversation_id")
    .eq("id", id)
    .maybeSingle();

  if (!pay) {
    return NextResponse.json({ error: "No se encontró el comprobante" }, { status: 404 });
  }
  if (pay.status !== "validated") {
    return NextResponse.json(
      { error: "El pago tiene que estar validado antes de dar el acceso" },
      { status: 409 },
    );
  }

  const courseId = tiendupCourseIdForEvent(pay.event_slug);
  if (!courseId) {
    return NextResponse.json(
      { error: "Este comprobante no corresponde a una masterclass con curso en Tiendup" },
      { status: 400 },
    );
  }

  // Email + nombre del contacto (a quién le damos el acceso).
  const { data: conv } = pay.conversation_id
    ? await sb
        .from("conversations")
        .select("contact_email, display_name")
        .eq("id", pay.conversation_id)
        .maybeSingle()
    : { data: null };

  const email = conv?.contact_email?.trim();
  if (!email) {
    return NextResponse.json(
      { error: "Todavía no tenemos el correo del contacto para darle el acceso" },
      { status: 409 },
    );
  }
  const { name, lastName } = splitFullName(conv?.display_name);

  const result = await enrollCourseByEmail({ courseId, email, name, lastName });

  if (result.ok) {
    await sb
      .from("payment_validations")
      .update({
        course_access_granted_at: new Date().toISOString(),
        course_access_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, email }, { status: 200 });
  }

  await sb
    .from("payment_validations")
    .update({ course_access_error: result.error ?? "error desconocido", updated_at: new Date().toISOString() })
    .eq("id", id);
  return NextResponse.json({ ok: false, error: result.error ?? "No se pudo dar el acceso" }, { status: 502 });
}
