import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/interventions?status=pending|resolved|all
//
// Bandeja de derivaciones al equipo: las notificaciones del agente que
// implican intervención humana, excluyendo las derivadas por comprobante
// (`validacion_pago`), que se trabajan en /payments (ver EXCLUDED_CATEGORIES).
//
// Resuelve la conversación de origen y quién marcó la derivación como
// atendida. RLS aísla por client_slug vía el JWT.
// ===========================================================================

const MAX_ITEMS = 300;

// Categorías que NO entran a la bandeja porque tienen su propio módulo:
//  - `validacion_pago` → /payments (comprobantes; el worker los procesa fuera
//    del orquestador y solo registra esa notificación).
//  - `reclamo_certificado` → /certificados (reclamos de certificados de
//    masterclass; misma idea: bandeja propia, ver src/app/api/certificados).
// El resto de las categorías (cliente_existente, interes_compra,
// fuera_de_conocimiento, escalado_manual, falla_tecnica) SÍ necesitan la
// atención del equipo acá (esta clienta va a tener muchas clientas existentes,
// y queremos verlas).
const EXCLUDED_CATEGORIES = ["validacion_pago", "reclamo_certificado"];

export interface InterventionItem {
  id: string;
  category: string;
  reason: string | null;
  summary: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  conversation: { id: string; displayName: string; source: string; externalId: string | null } | null;
}

export async function GET(req: NextRequest) {
  const sb = getSupabaseServerClient();
  const status = req.nextUrl.searchParams.get("status") ?? "pending";

  let query = sb
    .from("agent_notifications")
    .select("*")
    .not("category", "in", `(${EXCLUDED_CATEGORIES.join(",")})`)
    // Más antiguo primero: se prioriza a quien fue derivado antes (cola de trabajo).
    .order("created_at", { ascending: true })
    .limit(MAX_ITEMS);

  if (status === "pending") query = query.is("resolved_at", null);
  else if (status === "resolved") query = query.not("resolved_at", "is", null);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows?.length) {
    return NextResponse.json({ items: [] satisfies InterventionItem[] });
  }

  // Resolver conversaciones de origen.
  const convIds = Array.from(
    new Set(rows.map((r) => r.conversation_id).filter(Boolean) as string[]),
  );
  const { data: convs } = convIds.length
    ? await sb.from("conversations").select("id, display_name, source, external_id").in("id", convIds)
    : { data: [] };
  const convById = new Map((convs ?? []).map((c) => [c.id, c]));

  // Resolver quién atendió cada derivación.
  const resolverIds = Array.from(
    new Set(rows.map((r) => r.resolved_by).filter(Boolean) as string[]),
  );
  const { data: resolvers } = resolverIds.length
    ? await sb.from("profiles").select("id, name").in("id", resolverIds)
    : { data: [] };
  const resolverById = new Map((resolvers ?? []).map((p) => [p.id, p]));

  const items: InterventionItem[] = rows.map((r) => {
    const conv = r.conversation_id ? convById.get(r.conversation_id) : null;
    const resolver = r.resolved_by ? resolverById.get(r.resolved_by) : null;
    return {
      id: r.id,
      category: r.category,
      reason: r.reason,
      summary: r.summary,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedByName: resolver?.name ?? null,
      conversation: conv
        ? { id: conv.id, displayName: conv.display_name ?? "(sin nombre)", source: conv.source, externalId: conv.external_id ?? null }
        : null,
    };
  });

  return NextResponse.json({ items });
}
