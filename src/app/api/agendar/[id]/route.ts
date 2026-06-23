import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// PATCH /api/agendar/[id]
//
// Marca una conversación como agendada (el equipo la dio de alta) o la vuelve a
// pendiente. `id` es el id de la conversación. RLS asegura que solo se toquen
// filas del cliente activo.
// ===========================================================================

const patchSchema = z.object({
  agendada: z.boolean(),
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
  const sb = getSupabaseServerClient();

  const { data, error } = await sb
    .from("conversations")
    .update({ agendada: parsed.data.agendada })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "No se encontró la conversación" },
      { status: error ? 500 : 404 },
    );
  }

  return NextResponse.json({ id: data.id, agendada: parsed.data.agendada }, { status: 200 });
}
