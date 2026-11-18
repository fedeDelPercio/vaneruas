import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { grantCourseAccess, markCourseAccessOnly } from "@/lib/tiendup/grant";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// PATCH /api/payments/[id]/grant-access
//
// Botón "Dar acceso al curso" de Aprobaciones (Tiendup) para un comprobante de
// masterclass ya validado. Desde el 17/11/2026 el alta también corre sola al
// validar (src/lib/tiendup/auto-enroll.ts): este botón queda para los casos que
// el alta automática no pudo resolver (sin correo, figura con otro correo,
// error de Tiendup) y para forzar.
//
// La lógica vive en `grantCourseAccess` (src/lib/tiendup/grant.ts), compartida
// con el alta automática. Antes de inscribir chequea el listado real de
// inscriptos por correo y por nombre: si la persona figura con OTRO correo,
// devuelve 409 con el aviso y el equipo decide si fuerza (force: true).
//
// Si no figura en el curso, antes de inscribir se chequea que el correo exista
// como CLIENTE de la tienda (Tiendup crea uno nuevo si no existe). Si no
// existe, o no se pudo verificar, devuelve 409 { needsConfirm: "not_in_tiendup"
// | "customer_check_failed" } y el front pide confirmación explícita; con
// confirmNewCustomer: true inscribe igual (force también lo saltea: ya aceptó
// que se cree un cliente nuevo).
//
// Si el acceso queda dado, se le avisa a la persona por WhatsApp (una vez por
// curso). "Ya tiene acceso" (markOnly) solo marca: no toca Tiendup ni avisa.
// ===========================================================================

const bodySchema = z.object({
  force: z.boolean().optional(),
  // Confirmación explícita de que se cree un cliente NUEVO en Tiendup (el
  // correo no figura como cliente de la tienda, o no se pudo verificar).
  confirmNewCustomer: z.boolean().optional(),
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
  const confirmNewCustomer = parsed?.confirmNewCustomer === true;

  if (markOnly) {
    const sb = getSupabaseServerClient();
    const { data: pay } = await sb
      .from("payment_validations")
      .select("id, status")
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
    await markCourseAccessOnly(id, sb);
    return NextResponse.json({ ok: true, markedOnly: true }, { status: 200 });
  }

  const { outcome: o } = await grantCourseAccess(id, { mode: "manual", force, confirmNewCustomer });

  switch (o.kind) {
    case "not_found":
      return NextResponse.json({ error: "No se encontró el comprobante" }, { status: 404 });
    case "not_validated":
      return NextResponse.json(
        { error: "El pago tiene que estar validado antes de dar el acceso" },
        { status: 409 },
      );
    case "no_course":
      return NextResponse.json(
        { error: "Este comprobante no corresponde a una masterclass con curso en Tiendup" },
        { status: 400 },
      );
    case "no_email":
    case "invalid_email":
      return NextResponse.json(
        { error: "Todavía no tenemos el correo del contacto para darle el acceso" },
        { status: 409 },
      );
    case "listing_failed":
      // Solo pasa en modo automático; acá no debería llegar.
      return NextResponse.json(
        { error: "No se pudo leer el listado de inscriptos de Tiendup" },
        { status: 502 },
      );
    case "already_enrolled":
      return NextResponse.json(
        {
          ok: true,
          alreadyEnrolled: true,
          email: o.email,
          emailFixed: o.emailFixed,
          message: "Ya estaba inscripta en el curso",
        },
        { status: 200 },
      );
    case "name_conflict":
      // Aparece la MISMA persona pero con OTRO correo. Inscribir con el nuestro
      // crearía un cliente duplicado y no le daría acceso a su cuenta real.
      return NextResponse.json(
        {
          ok: false,
          warning: true,
          error:
            `Parece que ya tiene acceso como "${o.existing.name}" ` +
            `con el correo ${o.existing.email}. Nuestro correo (${o.email}) es distinto: si la inscribís igual, ` +
            `se va a crear un cliente NUEVO en Tiendup con ese correo y no va a acceder con su cuenta real. ` +
            `Verificá el correo antes de forzar.`,
          existing: o.existing,
          ourEmail: o.email,
        },
        { status: 409 },
      );
    case "needs_new_customer_confirm":
      return NextResponse.json(
        {
          ok: false,
          needsConfirm: o.reason,
          ourEmail: o.email,
          error:
            o.reason === "not_in_tiendup"
              ? "Este correo no figura como cliente en Tiendup. Si seguís, Tiendup va a crear un cliente nuevo con ese correo. Dar acceso igual?"
              : "No se pudo verificar si este correo figura como cliente en Tiendup. Si no figura, Tiendup va a crear un cliente nuevo con ese correo. Dar acceso igual?",
        },
        { status: 409 },
      );
    case "not_in_tiendup":
    case "customer_check_failed":
      // Solo pasan en modo automático; acá no deberían llegar.
      return NextResponse.json(
        { ok: false, error: "No se pudo verificar el correo en Tiendup" },
        { status: 502 },
      );
    case "enrolled":
      return NextResponse.json(
        { ok: true, email: o.email, emailFixed: o.emailFixed },
        { status: 200 },
      );
    case "enroll_failed":
      return NextResponse.json(
        { ok: false, error: o.error || "No se pudo dar el acceso" },
        { status: 502 },
      );
  }
}
