import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { testProvider } from "@/lib/providers/test-provider";

export const dynamic = "force-dynamic";

// Confirmación que recibe la profesional cuando su pago queda aprobado.
// Microcopy de agente: sin emoji, sin em dash, sin punto final, sin ¿¡.
const PAYMENT_APPROVED_MESSAGE =
  "Tu pago fue verificado correctamente, a la brevedad te llega un correo con todo el detalle para tu acceso";

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
  const { status, note, validatedBy } = parsed.data;
  const sb = getSupabaseServerClient();

  // Estado previo: para confirmar por WhatsApp solo en la transición a
  // 'validated' (no reenviar si ya estaba aprobado).
  const { data: prev } = await sb
    .from("payment_validations")
    .select("status, conversation_id")
    .eq("id", id)
    .maybeSingle();

  // Si vuelve a 'pending' se limpia la validación; si se valida/rechaza se sella.
  const isResolved = status !== "pending";
  const { data, error } = await sb
    .from("payment_validations")
    .update({
      status,
      validation_note: note ?? null,
      validated_by: isResolved ? validatedBy ?? null : null,
      validated_at: isResolved ? new Date().toISOString() : null,
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
  if (
    status === "validated" &&
    prev?.status !== "validated" &&
    prev?.conversation_id
  ) {
    try {
      await sb.from("messages").insert({
        conversation_id: prev.conversation_id,
        role: "assistant",
        content: PAYMENT_APPROVED_MESSAGE,
      });
      await sb
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", prev.conversation_id);
      await testProvider.sendMessage(prev.conversation_id, PAYMENT_APPROVED_MESSAGE);
    } catch (err) {
      console.error("[payments] no se pudo enviar la confirmación al cliente:", err);
    }
  }

  return NextResponse.json({ id: data.id, status }, { status: 200 });
}
