import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { markConversationTitleValidated } from "@/lib/titles/handle";

export const dynamic = "force-dynamic";

// ===========================================================================
// PATCH /api/titles/[id]
//
// Revisión manual de un título profesional que la IA no pudo dar por válido.
// El equipo lo mira desde el panel de Pagos y decide:
//
//  - approve: lo da por válido. Tilda a la contacta como clienta, libera el
//    comprobante retenido (si lo hay) y le confirma que pasó el título.
//  - reject: lo marca revisado sin habilitar nada (sale de la cola).
//
// RLS asegura que solo se toquen filas del cliente activo.
// ===========================================================================

const patchSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(2000).optional().nullable(),
  reviewedBy: z.string().uuid().optional().nullable(),
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
  const { action, note, reviewedBy } = parsed.data;
  const sb = getSupabaseServerClient();

  const { data: title } = await sb
    .from("professional_titles")
    .select("id, conversation_id")
    .eq("id", id)
    .maybeSingle();
  if (!title) {
    return NextResponse.json({ error: "No se encontró el título" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  if (action === "reject") {
    const { error } = await sb
      .from("professional_titles")
      .update({
        is_valid: false,
        reviewed_at: nowIso,
        reviewed_by: reviewedBy ?? null,
        validation_note: note ?? null,
      })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ id, action }, { status: 200 });
  }

  // approve: marcar este título válido + sellar como revisados los demás
  // pendientes de la misma conversación, y habilitar a la contacta.
  const { error: updErr } = await sb
    .from("professional_titles")
    .update({
      is_valid: true,
      reviewed_at: nowIso,
      reviewed_by: reviewedBy ?? null,
      validation_note: note ?? null,
    })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  if (title.conversation_id) {
    await sb
      .from("professional_titles")
      .update({ reviewed_at: nowIso, reviewed_by: reviewedBy ?? null })
      .eq("conversation_id", title.conversation_id)
      .is("reviewed_at", null);

    await markConversationTitleValidated(title.conversation_id, {
      systemNote: "Título profesional validado por el equipo, contacta marcada como clienta",
    });
  }

  return NextResponse.json({ id, action }, { status: 200 });
}
