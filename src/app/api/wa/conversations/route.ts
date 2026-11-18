import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { matchesContactQuery } from "@/lib/search";
import {
  loadInterventionConversationIds,
  loadPendingApprovalConversationIds,
  type InterventionInfo,
  type PendingApprovalInfo,
} from "@/lib/interventions";
import { clientEnv } from "@/lib/env";
import { isMissingColumnError, withOptionalColumns } from "@/lib/critical/classifier";
import { fetchAllRows } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/wa/conversations?q=&filter=all|intervencion|aprobar|criticos&offset=&limit=
//
// Filtros: "intervencion" (botón "Derivadas", también acepta ?filter=derivadas),
// "aprobar" (botón "Falta aprobar": comprobante pending o título sin revisar,
// mismo criterio que /revision) y "criticos" (tag "Crítico"). El viejo
// "humano" (con el equipo) se sacó el 18/11/2026: un ?filter=humano guardado
// cae a "all" sin romper.
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
// Columnas del tag "Crítico" (migración 034). Si la migración no está aplicada
// la lectura falla con 42703: se recuerda un rato y se sigue sin el tag.
const CRITICAL_COLS = ", critical, critical_reason";
const CRITICAL_RETRY_MS = 10 * 60_000;
let criticalMissingSince = 0;

function criticalAvailable(): boolean {
  return Date.now() - criticalMissingSince > CRITICAL_RETRY_MS;
}

type Filter = "all" | "intervencion" | "aprobar" | "criticos";

interface ConvRow {
  id: string;
  display_name: string;
  wa_jid: string | null;
  contact_email: string | null;
  mode: string;
  updated_at: string;
  is_existing_customer: boolean;
  critical?: boolean | null;
  critical_reason?: string | null;
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
  /**
   * Pills de estado de la fila, con el criterio de la cola de /revision:
   * comprobantes pendientes (y si alguno está retenido por título), títulos
   * sin revisar y derivaciones abiertas (sin contar `validacion_pago`).
   */
  status: {
    comprobantes: number;
    titulos: number;
    awaitingTitle: boolean;
    derivations: number;
  };
  /** Tag "Crítico" (false si la migración 034 no está aplicada). */
  critical: boolean;
  criticalReason: string | null;
  preview: WaPreview | null;
}

export interface WaConversationsResponse {
  items: WaConversationItem[];
  /** Total que coincide con la búsqueda y el filtro (no solo esta página). */
  total: number;
  hasMore: boolean;
  counts: { all: number; intervencion: number; aprobar: number; criticos: number };
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
    filterParam === "intervencion" ||
    filterParam === "aprobar" ||
    filterParam === "criticos"
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
  // Ambos devuelven id → detalle (tipo de pendiente), en pocas consultas
  // paginadas y cruzadas en memoria: nada de N+1 ni `.in()` gigantes.
  const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;
  let needsTeam: Map<string, InterventionInfo>;
  let pendingApproval: Map<string, PendingApprovalInfo>;
  try {
    [needsTeam, pendingApproval] = await Promise.all([
      loadInterventionConversationIds(sb, slug),
      loadPendingApprovalConversationIds(sb, clientEnv.NEXT_PUBLIC_CLIENT_SLUG),
    ]);
    // El contador es de la bandeja de WhatsApp: fuera las del banco de pruebas.
    const otras = await fetchAllRows((from, to) =>
      sb
        .from("conversations")
        .select("id")
        .eq("client_slug", slug)
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

  const [allCount, criticalCount] = await Promise.all([
    sb
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("client_slug", slug)
      .eq("source", "whatsapp"),
    criticalAvailable()
      ? sb
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("source", "whatsapp")
          .eq("client_slug", slug)
          .eq("critical", true)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (criticalCount.error && isMissingColumnError(criticalCount.error)) {
    criticalMissingSince = Date.now();
  }

  let pageRows: ConvRow[];
  let total: number;

  if (!q && filter === "all") {
    // Camino frecuente: solo la página pedida.
    const page = (cols: string) =>
      sb
        .from("conversations")
        .select(cols)
        .eq("client_slug", slug)
        .eq("source", "whatsapp")
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
    const { data, error } = await withCriticalFallback(page);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    pageRows = (data ?? []) as unknown as ConvRow[];
    total = allCount.count ?? pageRows.length;
  } else {
    // Con búsqueda o filtro: se traen todas (livianas) y se filtra en memoria,
    // así la búsqueda ignora tildes y encuentra el teléfono por cualquier tramo.
    const all: ConvRow[] = [];
    for (let from = 0; ; from += DB_PAGE) {
      const chunk = (cols: string) => {
        return sb
          .from("conversations")
          .select(cols)
          .eq("client_slug", slug)
          .eq("source", "whatsapp")
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + DB_PAGE - 1);
      };
      const { data, error } = await withCriticalFallback(chunk);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      all.push(...((data ?? []) as unknown as ConvRow[]));
      if (!data || data.length < DB_PAGE) break;
    }
    const filtered = all.filter(
      (c) =>
        (filter !== "intervencion" || needsTeam.has(c.id)) &&
        (filter !== "aprobar" || pendingApproval.has(c.id)) &&
        (filter !== "criticos" || c.critical === true) &&
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

  const items: WaConversationItem[] = pageRows.map((c) => {
    const approval = pendingApproval.get(c.id);
    return {
      id: c.id,
      displayName: c.display_name?.trim() || "(sin nombre)",
      phone: c.wa_jid,
      email: c.contact_email,
      mode: c.mode === "HUMAN" ? "HUMAN" : "AI",
      updatedAt: c.updated_at,
      isCustomer: c.is_existing_customer,
      needsTeam: needsTeam.has(c.id),
      pendingApproval: Boolean(approval),
      status: {
        comprobantes: approval?.comprobantes ?? 0,
        titulos: approval?.titulos ?? 0,
        awaitingTitle: approval?.awaitingTitle ?? false,
        derivations: needsTeam.get(c.id)?.derivations ?? 0,
      },
      critical: c.critical === true,
      criticalReason: c.critical === true ? c.critical_reason ?? null : null,
      preview: previews.get(c.id) ?? null,
    };
  });

  const body: WaConversationsResponse = {
    items,
    total,
    hasMore: offset + items.length < total,
    counts: {
      all: allCount.count ?? 0,
      intervencion: needsTeam.size,
      aprobar: pendingApproval.size,
      criticos: criticalCount.count ?? 0,
    },
  };
  return NextResponse.json(body);
}

/** Consulta de conversaciones con las columnas del tag "Crítico" si existen. */
async function withCriticalFallback<T extends { error: { code?: string; message: string } | null }>(
  run: (cols: string) => PromiseLike<T>,
): Promise<T> {
  const { res, missing } = await withOptionalColumns(run, CONV_COLS, CRITICAL_COLS, criticalAvailable());
  if (missing) criticalMissingSince = Date.now();
  return res;
}
