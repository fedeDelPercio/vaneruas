import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/messages/[conversationId] — mensajes de una conversacion (orden
// cronologico). Soporta ?limit=N para traer solo los ultimos N.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 200) : null;

  const supabase = getSupabaseServerClient();
  const queryBuilder = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId);

  // Para limitar a los ultimos N: ordenar desc, cortar y luego revertir.
  if (limit) {
    const { data, error } = await queryBuilder
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: (data ?? []).reverse() });
  }

  const { data, error } = await queryBuilder.order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data });
}
