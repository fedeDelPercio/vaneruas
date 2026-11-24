import { withoutStaleEnrollmentNotifications } from "@/lib/tiendup/pending-notifications";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { matchesContactQuery } from "@/lib/search";

// ===========================================================================
// Listado de derivaciones al equipo, compartido por Derivaciones y
// Certificados (misma tabla, distinta categoría).
//
// - Pendientes: más antiguo primero (cola de trabajo). Atendidas y Todas: más
//   nuevo primero (historial).
// - Se muestran hasta MAX_ITEMS; `total` dice cuántas hay en realidad.
// - Con búsqueda (`q`) se busca en TODAS, no solo en las que entran en el
//   tope: si no, alguien derivado hace meses daba "Sin resultados" aunque
//   estuviera.
// ===========================================================================

export const MAX_NOTIFICATION_ITEMS = 300;

export interface NotificationListItem {
  id: string;
  category: string;
  reason: string | null;
  summary: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  conversation: {
    id: string;
    displayName: string;
    source: string;
    externalId: string | null;
    phone: string | null;
    ghlConversationId: string | null;
  } | null;
}

export interface NotificationListResult {
  items: NotificationListItem[];
  /** Cuántas coinciden con el estado y la búsqueda (puede ser más que `items`). */
  total: number;
}

function chunked<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function listNotifications(opts: {
  sb: SupabaseClient<Database>;
  status: string;
  q: string;
  /** Solo esta categoría (Certificados). */
  onlyCategory?: string;
  /** Todas menos estas (Derivaciones). */
  excludeCategories?: string[];
}): Promise<NotificationListResult> {
  const { sb, status, onlyCategory, excludeCategories } = opts;
  const q = opts.q.trim();
  const ascending = status === "pending";

  const fetchedRows = await fetchAllRows((from, to) => {
    let query = sb.from("agent_notifications").select("*");
    if (onlyCategory) query = query.eq("category", onlyCategory);
    if (excludeCategories?.length) {
      query = query.not("category", "in", `(${excludeCategories.join(",")})`);
    }
    if (status === "pending") query = query.is("resolved_at", null);
    else if (status === "resolved") query = query.not("resolved_at", "is", null);
    return query
      .order("created_at", { ascending })
      .order("id", { ascending: true })
      .range(from, to);
  });

  const rows = await withoutStaleEnrollmentNotifications(sb, fetchedRows);

  // Conversaciones de origen. Sin búsqueda alcanza con las de la página; con
  // búsqueda hacen falta todas, porque se filtra por nombre y teléfono.
  type Conv = {
    id: string;
    display_name: string;
    source: string;
    external_id: string | null;
    wa_jid: string | null;
    ghl_conversation_id: string | null;
  };
  const convById = new Map<string, Conv>();
  async function resolve(ids: string[]) {
    const missing = Array.from(new Set(ids)).filter((id) => !convById.has(id));
    const results = await Promise.all(
      chunked(missing, 100).map((chunk) =>
        sb
          .from("conversations")
          .select("id, display_name, source, external_id, wa_jid, ghl_conversation_id")
          .in("id", chunk),
      ),
    );
    for (const r of results) {
      if (r.error) throw new Error(r.error.message);
      for (const c of r.data ?? []) convById.set(c.id, c);
    }
  }

  let matched = rows;
  if (q) {
    await resolve(rows.map((r) => r.conversation_id).filter(Boolean));
    matched = rows.filter((r) => {
      const conv = r.conversation_id ? convById.get(r.conversation_id) : null;
      return matchesContactQuery(q, { texts: [conv?.display_name], phones: [conv?.wa_jid] });
    });
  }
  const total = matched.length;
  const page = matched.slice(0, MAX_NOTIFICATION_ITEMS);
  await resolve(page.map((r) => r.conversation_id).filter(Boolean));

  const resolverIds = Array.from(
    new Set(page.map((r) => r.resolved_by).filter(Boolean) as string[]),
  );
  const { data: resolvers } = resolverIds.length
    ? await sb.from("profiles").select("id, name").in("id", resolverIds)
    : { data: [] };
  const resolverById = new Map((resolvers ?? []).map((p) => [p.id, p]));

  const items: NotificationListItem[] = page.map((r) => {
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
        ? {
            id: conv.id,
            displayName: conv.display_name ?? "(sin nombre)",
            source: conv.source,
            externalId: conv.external_id ?? null,
            phone: conv.wa_jid ?? null,
            ghlConversationId: conv.ghl_conversation_id ?? null,
          }
        : null,
    };
  });

  return { items, total };
}
