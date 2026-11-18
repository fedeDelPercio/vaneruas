import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { loadTiendupStatus } from "@/lib/tiendup/status-server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// GET /api/wa/tiendup-status/[conversationId]
//
// Estado en vivo del acceso a Tiendup de la persona, por curso (enrolled /
// other_email / not_found / error / unavailable, ver src/lib/tiendup/status.ts).
// Solo lectura: a Tiendup solo le hace GET del listado de inscriptos, con cache
// de 5 min por curso. La ficha lo pide una vez al abrirse (no en realtime).
//
// Mismo acceso que la ficha (GET /api/wa/contact/[id]): cliente del panel con
// el JWT del tenant (RLS) y, además, `client_slug` explícito en cada query.
// ===========================================================================

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }
  try {
    const status = await loadTiendupStatus(
      getSupabaseServerClient(),
      conversationId,
      clientEnv.NEXT_PUBLIC_CLIENT_SLUG,
    );
    if (!status) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo consultar Tiendup" },
      { status: 500 },
    );
  }
}
