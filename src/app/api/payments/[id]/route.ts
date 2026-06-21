import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { deliverAssistantToWhatsApp } from "@/lib/whatsapp-delivery";

export const dynamic = "force-dynamic";

// Confirmación que recibe la profesional cuando su pago queda aprobado. Le
// pedimos el correo para darle el acceso (lo vamos a usar para el alta en
// Tiendup en un paso siguiente). Voz de Valentina (Vanesa Rúas Formación
// Profesional): cálida, con un emoji, sin punto final.
const PAYMENT_APPROVED_ASK_EMAIL =
  "Buenísimo, tu pago quedó verificado ✅ Para darte el acceso al curso necesito tu correo electrónico, me lo compartís?";
// Cuando ya tenemos el correo (clienta registrada en GHL o lo compartió antes),
// no se lo volvemos a pedir: solo confirmamos.
const PAYMENT_APPROVED_HAS_EMAIL =
  "Buenísimo, tu pago quedó verificado ✅ Ya te enviamos el acceso al curso a tu correo, cualquier cosa quedamos en contacto 🙌";

// ===========================================================================
// PATCH /api/payments/[id]
//
// Marca un comprobante como validado o rechazado. El equipo lo dispara desde el
// panel tras chequear el pago contra su contabilidad. Guarda quién lo validó
// (validated_by) y cuándo, más una nota opcional. RLS asegura que solo se
// puedan tocar filas del cliente activo.
// ===========================================================================

const patchSchema = z.object({
  status: z.enum(["validated", "rejected", "pending"]),
  note: z.string().max(2000).optional().nullable(),
  validatedBy: z.string().uuid().optional().nullable(),
  // Forzar la aprobación de un comprobante retenido aunque la contacta no haya
  // acreditado su título profesional (ej. el equipo decide habilitarlo igual).
  force: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { status, note, validatedBy, force } = parsed.data;
  const sb = getSupabaseServerClient();

  // Estado previo: para confirmar por WhatsApp solo en la transición a
  // 'validated' (no reenviar si ya estaba aprobado).
  const { data: prev } = await sb
    .from("payment_validations")
    .select("status, conversation_id, awaiting_title")
    .eq("id", id)
    .maybeSingle();

  // Un comprobante retenido (esperando el título profesional) no se puede
  // aprobar por la vía normal: o se valida el título (que lo libera) o el equipo
  // FUERZA la aprobación explícitamente (force=true). Sin force, devolvemos 409.
  const forcing = status === "validated" && prev?.awaiting_title && force === true;
  if (status === "validated" && prev?.awaiting_title && !forcing) {
    return NextResponse.json(
      {
        error:
          "Este comprobante está esperando la validación del título profesional. Validá el título o forzá la aprobación.",
      },
      { status: 409 },
    );
  }

  // Si vuelve a 'pending' se limpia la validación; si se valida/rechaza se sella.
  // Al forzar la aprobación, además se libera el retén (awaiting_title=false).
  const isResolved = status !== "pending";
  const { data, error } = await sb
    .from("payment_validations")
    .update({
      status,
      validation_note: note ?? null,
      validated_by: isResolved ? validatedBy ?? null : null,
      validated_at: isResolved ? new Date().toISOString() : null,
      ...(forcing ? { awaiting_title: false } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "No se encontró el comprobante" },
      { status: error ? 500 : 404 },
    );
  }

  // Al aprobar: avisar a la profesional por su canal (WhatsApp en prod, panel
  // en test). El mensaje se persiste en `messages` (system of record) y el
  // provider se encarga de la entrega externa.
  // Al forzar la aprobación damos por acreditada a la contacta (no la volvemos a
  // frenar en el gate de título en próximos comprobantes de esta conversación).
  if (forcing && prev?.conversation_id) {
    await sb
      .from("conversations")
      .update({ is_existing_customer: true, updated_at: new Date().toISOString() })
      .eq("id", prev.conversation_id);
  }

  if (
    status === "validated" &&
    prev?.status !== "validated" &&
    prev?.conversation_id
  ) {
    try {
      // ¿Ya tenemos el correo? (clienta registrada en GHL o lo compartió antes).
      // Si lo tenemos, no se lo volvemos a pedir.
      const { data: conv } = await sb
        .from("conversations")
        .select("contact_email")
        .eq("id", prev.conversation_id)
        .maybeSingle();
      const message = conv?.contact_email?.trim()
        ? PAYMENT_APPROVED_HAS_EMAIL
        : PAYMENT_APPROVED_ASK_EMAIL;

      const { data: inserted } = await sb
        .from("messages")
        .insert({
          conversation_id: prev.conversation_id,
          role: "assistant",
          content: message,
        })
        .select("id")
        .single();
      await sb
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", prev.conversation_id);
      // Entrega real al WhatsApp del contacto (vía GHL) si corresponde.
      await deliverAssistantToWhatsApp({
        conversationId: prev.conversation_id,
        messageId: inserted?.id,
        content: message,
      });
    } catch (err) {
      console.error("[payments] no se pudo enviar la confirmación al cliente:", err);
    }
  }

  return NextResponse.json({ id: data.id, status }, { status: 200 });
}
