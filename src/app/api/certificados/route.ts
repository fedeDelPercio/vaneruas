import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/certificados?status=pending|resolved|all
//
// Reclamos de certificados/diplomas de masterclass: notificaciones del agente
// con categoría `reclamo_certificado` (asistentes que dicen no haber recibido
// su certificado). Es la contraparte de /api/interventions, pero filtrando
// SOLO esa categoría: tiene su propio módulo /certificados, igual que los
// comprobantes (`validacion_pago`) tienen el de /payments.
//
// Resuelve la conversación de origen y quién marcó el reclamo como atendido.
// RLS aísla por client_slug vía el JWT.
// ===========================================================================

const MAX_ITEMS = 300;

const CERTIFICADO_CATEGORY = "reclamo_certificado";

export interface CertificadoItem {
  id: string;
  reason: string | null;
  summary: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  conversation: { id: string; displayName: string; source: string } | null;
}

export async function GET(req: NextRequest) {
  const sb = getSupabaseServerClient();
  const status = req.nextUrl.searchParams.get("status") ?? "pending";

  let query = sb
    .from("agent_notifications")
    .select("*")
    .eq("category", CERTIFICADO_CATEGORY)
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS);

  if (status === "pending") query = query.is("resolved_at", null);
  else if (status === "resolved") query = query.not("resolved_at", "is", null);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows?.length) {
    return NextResponse.json({ items: [] satisfies CertificadoItem[] });
  }

  // Resolver conversaciones de origen.
  const convIds = Array.from(
    new Set(rows.map((r) => r.conversation_id).filter(Boolean) as string[]),
  );
  const { data: convs } = convIds.length
    ? await sb.from("conversations").select("id, display_name, source").in("id", convIds)
    : { data: [] };
  const convById = new Map((convs ?? []).map((c) => [c.id, c]));

  // Resolver quién atendió cada reclamo.
  const resolverIds = Array.from(
    new Set(rows.map((r) => r.resolved_by).filter(Boolean) as string[]),
  );
  const { data: resolvers } = resolverIds.length
    ? await sb.from("profiles").select("id, name").in("id", resolverIds)
    : { data: [] };
  const resolverById = new Map((resolvers ?? []).map((p) => [p.id, p]));

  const items: CertificadoItem[] = rows.map((r) => {
    const conv = r.conversation_id ? convById.get(r.conversation_id) : null;
    const resolver = r.resolved_by ? resolverById.get(r.resolved_by) : null;
    return {
      id: r.id,
      reason: r.reason,
      summary: r.summary,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedByName: resolver?.name ?? null,
      conversation: conv
        ? { id: conv.id, displayName: conv.display_name ?? "(sin nombre)", source: conv.source }
        : null,
    };
  });

  return NextResponse.json({ items });
}
