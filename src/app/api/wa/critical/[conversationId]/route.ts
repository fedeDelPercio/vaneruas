import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { isMissingColumnError } from "@/lib/critical/classifier";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// DELETE /api/wa/critical/[conversationId]
//
// El equipo saca el tag "Crítico" a mano (botón en el header del chat; roles
// dev, client y asesor, los mismos que ven /wa). No toca
// `critical_evaluated_at`: la conversación se vuelve a evaluar recién con el
// próximo mensaje de la contacta. Tampoco toca `updated_at` (ordena la lista).
// ===========================================================================

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }
  const { data, error } = await getSupabaseServerClient()
    .from("conversations")
    .update({ critical: false, critical_reason: null, critical_at: null })
    .eq("id", conversationId)
    .eq("client_slug", clientEnv.NEXT_PUBLIC_CLIENT_SLUG)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: "El tag Crítico todavía no está habilitado en la base" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
