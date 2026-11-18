import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { matchesContactQuery } from "@/lib/search";
import {
  loadInterventionConversationIds,
  loadPendingApprovalConversationIds,
} from "@/lib/interventions";
import { clientEnv } from "@/lib/env";
import { fetchAllRows } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/wa/conversations?q=&filter=all|intervencion|aprobar|humano&offset=&limit=
//
// Filtros: "intervencion" (botón "Derivadas", también acepta ?filter=derivadas),
// "aprobar" (botón "Falta aprobar": comprobante pending o título sin revisar,
// mismo criterio que /revision) y "humano" (con el equipo).
//
// Lista del chat de WhatsApp. Reemplaza la carga directa desde el navegador,
// que tenía tres problemas con el volumen real (más de 1.500 conversaciones):
//   - PostgREST corta en 1.000 filas, así que las más viejas no existían.
//   - Las vistas previas salían de UNA consulta con tope de 200 mensajes para
//     todas las conversaciones juntas: casi todas quedaban en "Sin mensajes".
//   - No había forma de buscar.
//
// Acá se pagina, se busca (nombre, teléfono o correo, sin distinguir tildes) y
// se trae el último mensaje de cada conversación de la página pedida.
// ===========================================================================

const PAGE_DEFAULT = 40;
const PAGE_MAX = 300;
// Ids por consulta de vistas previas (la lista de ids viaja en la URL).
const PREVIEW_CHUNK = 50;
const DB_PAGE = 1000;
const CONV_COLS =
  "id, display_name, wa_jid, contact_email, mode, updated_at, is_existing_customer";

type Filter = "all" | "intervencion" | "aprobar" | "humano";

interface ConvRow {
  id: string;
  display_name: string;
  wa_jid: string | null;
  contact_email: string | null;
  mode: string;
  updated_at: string;
  is_existing_customer: boolean;
}

export interface WaPreview {
  role: string;
  text: string;
  at: string;
  hasAttachment: boolean;
}

export interface WaConversationItem {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  mode: "AI" | "HUMAN";
  updatedAt: string;
  isCustomer: boolean;
  /** Necesita intervención del equipo (notificación sin resolver). */
  needsTeam: boolean;
  /** Tiene un comprobante o un título esperando aprobación. */
  pendingApproval: boolean;
  preview: WaPreview | null;
}

export interface WaConversationsResponse {
  items: WaConversationItem[];
  /** Total que coincide con la búsqueda y el filtro (no solo esta página). */
  total: number;
  hasMore: boolean;
  counts: { all: number; intervencion: number; aprobar: number; humano: number };
}

// Texto fijo (en inglés) que manda GHL cuando la clienta envía algo que no
// sabe pasar. No lo escribió ella: se muestra como lo que es.
const GHL_UNSUPPORTED = "Message type is currently not supported.";

function previewText(content: string): string {
  if (content.trim() === GHL_UNSUPPORTED) return "Mensaje en otro formato";
  return content
    .split("\n")
    .filter((line) => line.trim() !== "---")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const filterParam = sp.get("filter");
  const filter: Filter =
    filterParam === "intervencion" || filterParam === "humano" || filterParam === "aprobar"
      ? filterParam
      : // Nombre del botón (y links guardados).
        filterParam === "derivadas"
        ? "intervencion"
        : filterParam === "falta-aprobar"
          ? "aprobar"
          : "all";
  const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);
  const limit = Math.min(
    Math.max(Number(sp.get("limit") ?? PAGE_DEFAULT) || PAGE_DEFAULT, 1),
    PAGE_MAX,
  );

  const sb = getSupabaseServerClient();

  // Conversaciones que necesitan intervención del equipo (punto de aviso y
  // filtro): notificaciones sin resolver, con el criterio de
  // src/lib/interventions.ts. Paginado y cruzado en memoria.
  let needsTeam: Set<string>;
  let pendingApproval: Set<string>;
  try {
    [needsTeam, pendingApproval] = await Promise.all([
      loadInterventionConversationIds(sb),
      loadPendingApprovalConversationIds(sb, clientEnv.NEXT_PUBLIC_CLIENT_SLUG),
    ]);
    // El contador es de la bandeja de WhatsApp: fuera las del banco de pruebas.
    const otras = await fetchAllRows((from, to) =>
      sb
        .from("conversations")
        .select("id")
        .neq("source", "whatsapp")
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const c of otras) {
      needsTeam.delete(c.id);
      pendingApproval.delete(c.id);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudieron cargar las intervenciones" },
      { status: 500 },
    );
  }

  const [allCount, humanCount] = await Promise.all([
    sb.from("conversations").select("id", { count: "exact", head: true }).eq("source", "whatsapp"),
    sb
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("source", "whatsapp")
      .eq("mode", "HUMAN"),
  ]);

  let pageRows: ConvRow[];
  let total: number;

  if (!q && filter === "all") {
    // Camino frecuente: solo la página pedida.
    const { data, error } = await sb
      .from("conversations")
      .select(CONV_COLS)
      .eq("source", "whatsapp")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    pageRows = (data ?? []) as ConvRow[];
    total = allCount.count ?? pageRows.length;
  } else {
    // Con búsqueda o filtro: se traen todas (livianas) y se filtra en memoria,
    // así la búsqueda ignora tildes y encuentra el teléfono por cualquier tramo.
    const all: ConvRow[] = [];
    for (let from = 0; ; from += DB_PAGE) {
      let query = sb.from("conversations").select(CONV_COLS).eq("source", "whatsapp");
      if (filter === "humano") query = query.eq("mode", "HUMAN");
      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + DB_PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      all.push(...((data ?? []) as ConvRow[]));
      if (!data || data.length < DB_PAGE) break;
    }
    const filtered = all.filter(
      (c) =>
        (filter !== "intervencion" || needsTeam.has(c.id)) &&
        (filter !== "aprobar" || pendingApproval.has(c.id)) &&
        matchesContactQuery(q, {
          texts: [c.display_name, c.contact_email],
          phones: [c.wa_jid],
        }),
    );
    total = filtered.length;
    pageRows = filtered.slice(offset, offset + limit);
  }

  // Último mensaje de cada conversación de la página. Una consulta para todas
  // y, para las que no entren en el tope, una consulta puntual por cada una.
  const previews = new Map<string, WaPreview>();
  const ids = pageRows.map((c) => c.id);
  if (ids.length) {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += PREVIEW_CHUNK) chunks.push(ids.slice(i, i + PREVIEW_CHUNK));
    const results = await Promise.all(
      chunks.map((chunk) =>
        sb
          .from("messages")
          .select("conversation_id, role, content, attachment_path, created_at")
          .in("conversation_id", chunk)
          .order("created_at", { ascending: false })
          .limit(400),
      ),
    );
    const recent = results.flatMap((r) => r.data ?? []);
    for (const m of recent) {
      if (previews.has(m.conversation_id)) continue;
      previews.set(m.conversation_id, {
        role: m.role,
        text: previewText(m.content ?? ""),
        at: m.created_at,
        hasAttachment: Boolean(m.attachment_path),
      });
    }
    const missing = ids.filter((id) => !previews.has(id));
    await Promise.all(
      missing.map(async (id) => {
        const { data } = await sb
          .from("messages")
          .select("role, content, attachment_path, created_at")
          .eq("conversation_id", id)
          .order("created_at", { ascending: false })
          .limit(1);
        const m = data?.[0];
        if (!m) return;
        previews.set(id, {
          role: m.role,
          text: previewText(m.content ?? ""),
          at: m.created_at,
          hasAttachment: Boolean(m.attachment_path),
        });
      }),
    );
  }

  const items: WaConversationItem[] = pageRows.map((c) => ({
    id: c.id,
    displayName: c.display_name?.trim() || "(sin nombre)",
    phone: c.wa_jid,
    email: c.contact_email,
    mode: c.mode === "HUMAN" ? "HUMAN" : "AI",
    updatedAt: c.updated_at,
    isCustomer: c.is_existing_customer,
    needsTeam: needsTeam.has(c.id),
    pendingApproval: pendingApproval.has(c.id),
    preview: previews.get(c.id) ?? null,
  }));

  const body: WaConversationsResponse = {
    items,
    total,
    hasMore: offset + items.length < total,
    counts: {
      all: allCount.count ?? 0,
      intervencion: needsTeam.size,
      aprobar: pendingApproval.size,
      humano: humanCount.count ?? 0,
    },
  };
  return NextResponse.json(body);
}
