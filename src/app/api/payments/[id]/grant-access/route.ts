import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  enrollCourseByEmail,
  tiendupCourseIdForEvent,
  splitFullName,
  listEnrolled,
  findExistingEnrollment,
} from "@/lib/tiendup/client";

export const dynamic = "force-dynamic";

// ===========================================================================
// PATCH /api/payments/[id]/grant-access
//
// Da acceso al curso (Tiendup) para un comprobante de masterclass ya validado.
// SIEMPRE manual: lo dispara el equipo desde Aprobaciones, por caso.
//
// GUARDA IMPORTANTE: el mail que capturamos por WhatsApp no es confiable (typos,
// truncados, o la persona usa otro mail en Tiendup). Si inscribimos con un mail
// equivocado, Tiendup crea un cliente NUEVO con ese mail basura y la persona real
// sigue sin acceso. Por eso, antes de inscribir chequeamos si ya está en el curso:
//   - match por mail  → ya tiene acceso: solo lo marcamos, no inscribimos de nuevo.
//   - match por NOMBRE (con otro mail) → 409 con el aviso; el equipo decide si
//     igual quiere inscribirla con nuestro mail (force: true).
//   - sin match → inscribimos.
// ===========================================================================

const bodySchema = z.object({
  force: z.boolean().optional(),
  // "Ya tiene acceso": marca el acceso como dado SIN inscribir en Tiendup. Para
  // casos que el equipo ya resolvió por afuera (la dieron de alta a mano, o ya
  // estaba y el cruce no la agarró). No requiere mail ni curso mapeado.
  markOnly: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body).data;
  const force = parsed?.force === true;
  const markOnly = parsed?.markOnly === true;
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

  // "Ya tiene acceso": marca sin inscribir en Tiendup. Corta acá; no toca el
  // curso ni el mail ni la API de Tiendup.
  if (markOnly) {
    await sb
      .from("payment_validations")
      .update({
        course_access_granted_at: new Date().toISOString(),
        course_access_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, markedOnly: true }, { status: 200 });
  }

  const courseId = tiendupCourseIdForEvent(pay.event_slug);
  if (!courseId) {
    return NextResponse.json(
      { error: "Este comprobante no corresponde a una masterclass con curso en Tiendup" },
      { status: 400 },
    );
  }

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
  const fullName = conv?.display_name ?? null;

  // --- Chequeo previo contra el listado real de inscriptos de Tiendup ---
  const enrolled = await listEnrolled(courseId);
  const existing = findExistingEnrollment({ enrolled, email, fullName });

  if (existing?.matchedBy === "email") {
    // Ya está inscripta con este mail: no hace falta inscribir de nuevo, solo
    // dejamos constancia en el panel.
    await sb
      .from("payment_validations")
      .update({
        course_access_granted_at: new Date().toISOString(),
        course_access_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json(
      { ok: true, alreadyEnrolled: true, email, message: "Ya estaba inscripta en el curso" },
      { status: 200 },
    );
  }

  if (existing?.matchedBy === "nombre" && !force) {
    // Aparece la MISMA persona pero con OTRO mail. Inscribir con el nuestro
    // crearía un cliente duplicado y no le daría acceso a su cuenta real.
    const e = existing.enrolled;
    return NextResponse.json(
      {
        ok: false,
        warning: true,
        error:
          `Parece que ya tiene acceso como "${[e.name, e.lastName].filter(Boolean).join(" ")}" ` +
          `con el correo ${e.email}. Nuestro correo (${email}) es distinto: si la inscribís igual, ` +
          `se va a crear un cliente NUEVO en Tiendup con ese correo y no va a acceder con su cuenta real. ` +
          `Verificá el correo antes de forzar.`,
        existing: { name: [e.name, e.lastName].filter(Boolean).join(" "), email: e.email },
        ourEmail: email,
      },
      { status: 409 },
    );
  }

  // --- Inscribir ---
  const { name, lastName } = splitFullName(fullName);
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
    .update({
      course_access_error: result.error ?? "error desconocido",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return NextResponse.json(
    { ok: false, error: result.error ?? "No se pudo dar el acceso" },
    { status: 502 },
  );
}
