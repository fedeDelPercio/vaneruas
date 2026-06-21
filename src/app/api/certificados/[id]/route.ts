import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// PATCH /api/certificados/[id]
//
// Marca un reclamo de certificado como atendido (resolved) o lo vuelve a
// pendiente. El equipo lo dispara desde el módulo /certificados una vez que
// reenvió el certificado. Es la misma fila de `agent_notifications`, así que
// el endpoint es equivalente al de /interventions; se separa para mantener el
// módulo autocontenido. RLS asegura que solo se toquen filas del cliente activo.
// ===========================================================================

const patchSchema = z.object({
  resolved: z.boolean(),
  resolvedBy: z.string().uuid().optional().nullable(),
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
  const { resolved, resolvedBy } = parsed.data;
  const sb = getSupabaseServerClient();

  const { data, error } = await sb
    .from("agent_notifications")
    .update({
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? resolvedBy ?? null : null,
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "No se encontró el reclamo" },
      { status: error ? 500 : 404 },
    );
  }

  return NextResponse.json({ id: data.id, resolved }, { status: 200 });
}
