import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/feedback
//
// Lista los comentarios reales (content no vacío) de este cliente, joineados
// con autor (profiles), conversación (conversations) y snippet del mensaje
// comentado cuando aplica (messages). Devuelve un array plano, ordenado por
// fecha descendente.
//
// El aislamiento por cliente lo enforce RLS a través del JWT con claim
// `client_slug`. No hace falta filtrar manual.
// ===========================================================================

const MAX_ITEMS = 200;
const SNIPPET_LEN = 220;

export interface FeedbackItem {
  id: string;
  kind: "note" | "negative" | "positive";
  content: string;
  createdAt: string;
  author: { id: string; name: string; role: string } | null;
  conversation: { id: string; displayName: string; source: string } | null;
  targetType: "conversation" | "message";
  targetMessageId: string | null;
  targetMessageSnippet: string | null;
  targetMessageRole: string | null;
}

export async function GET() {
  const sb = getSupabaseServerClient();

  const { data: comments, error: cErr } = await sb
    .from("comments")
    .select("id, target_type, target_id, author_id, content, kind, created_at")
    .neq("content", "")
    .not("content", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS);

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!comments?.length) {
    return NextResponse.json({ items: [] satisfies FeedbackItem[] });
  }

  // Resolver autores.
  const authorIds = Array.from(
    new Set(comments.map((c) => c.author_id).filter(Boolean) as string[]),
  );
  const { data: profiles } = authorIds.length
    ? await sb.from("profiles").select("id, name, role").in("id", authorIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Resolver mensajes comentados (target_type === "message").
  const msgIds = comments
    .filter((c) => c.target_type === "message")
    .map((c) => c.target_id);
  const { data: msgs } = msgIds.length
    ? await sb
        .from("messages")
        .select("id, conversation_id, role, content")
        .in("id", msgIds)
    : { data: [] };
  const msgById = new Map((msgs ?? []).map((m) => [m.id, m]));

  // Resolver conversaciones (puede ser target directo o via mensaje).
  const directConvIds = comments
    .filter((c) => c.target_type === "conversation")
    .map((c) => c.target_id);
  const fromMsgConvIds = (msgs ?? []).map((m) => m.conversation_id);
  const convIds = Array.from(new Set([...directConvIds, ...fromMsgConvIds]));
  const { data: convs } = convIds.length
    ? await sb
        .from("conversations")
        .select("id, display_name, source")
        .in("id", convIds)
    : { data: [] };
  const convById = new Map((convs ?? []).map((c) => [c.id, c]));

  const items: FeedbackItem[] = comments.map((c) => {
    const author = c.author_id ? profileById.get(c.author_id) : null;
    const isMsgTarget = c.target_type === "message";
    const msg = isMsgTarget ? msgById.get(c.target_id) : null;
    const convId = isMsgTarget ? msg?.conversation_id : c.target_id;
    const conv = convId ? convById.get(convId) : null;

    return {
      id: c.id,
      kind: c.kind as FeedbackItem["kind"],
      content: c.content ?? "",
      createdAt: c.created_at,
      author: author
        ? { id: author.id, name: author.name, role: author.role }
        : null,
      conversation: conv
        ? {
            id: conv.id,
            displayName: conv.display_name ?? "(sin nombre)",
            source: conv.source,
          }
        : null,
      targetType: c.target_type as "conversation" | "message",
      targetMessageId: isMsgTarget ? c.target_id : null,
      targetMessageSnippet: msg
        ? (msg.content ?? "").slice(0, SNIPPET_LEN) +
          ((msg.content ?? "").length > SNIPPET_LEN ? "…" : "")
        : null,
      targetMessageRole: msg?.role ?? null,
    };
  });

  return NextResponse.json({ items });
}
