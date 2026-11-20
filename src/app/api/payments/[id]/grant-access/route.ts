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
// error de Tiendup).
//
// La lógica vive en `grantCourseAccess` (src/lib/tiendup/grant.ts), compartida
// con el alta automática. En este botón (modo manual) inscribe DIRECTO, sin
// confirmación previa (20/11/2026): si ya figura en el curso con este correo
// solo se marca; si no, inscribe aunque la persona figure por nombre con otro
// correo o el correo no sea cliente de la tienda (Tiendup crea el cliente).
// Nunca devuelve 409 de confirmación. `force` y `confirmNewCustomer` se
// aceptan en el body por compatibilidad y se ignoran.
//
// Si el acceso queda dado, se le avisa a la persona por WhatsApp (una vez por
// curso). "Ya tiene acceso" (markOnly) solo marca: no toca Tiendup ni avisa.
// ===========================================================================

const bodySchema = z.object({
  // Compatibilidad: se ignoran (el alta manual no pide confirmación).
  force: z.boolean().optional(),
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
  const markOnly = parsed?.markOnly === true;

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

  const { outcome: o } = await grantCourseAccess(id, { mode: "manual" });

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
    case "not_in_tiendup":
    case "customer_check_failed":
      // Solo pasan en modo automático; acá no deberían llegar.
      return NextResponse.json(
        { ok: false, error: "No se pudo dar el acceso" },
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
