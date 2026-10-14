import type { SupabaseClient } from "@supabase/supabase-js";

// ===========================================================================
// Importador de los mensajes que escribe el EQUIPO desde GoHighLevel.
//
// Por qué existe: la app de GHL (webhook unificado Inbound+Outbound) no está
// instalada en esta cuenta, así que los mensajes entrantes llegan por el
// workflow "Customer Replied" y los SALIENTES que escribe una persona no nos
// llegan nunca. Resultado: el panel mostraba conversaciones "sin responder" que
// el equipo ya había contestado, Valentina no veía lo que dijo un humano antes
// que ella, y no había forma de medir cuánto atiende la IA y cuánto el equipo.
//
// Este importador recorre las conversaciones de GHL ordenadas por fecha del
// último mensaje, se detiene cuando pasa la marca de agua, y guarda como
// role="human" todo saliente que no sea nuestro.
//
// Cómo sabemos si un saliente es NUESTRO:
//   a) su id de GHL está en messages.external_id (lo guardamos al enviar), o
//   b) su texto coincide con un saliente nuestro de esa misma conversación
//      (cubre lo que sale del panel, ej. "tu pago quedó verificado", donde no
//      guardamos el messageId que devuelve GHL).
// Todo lo demás lo escribió una persona.
// ===========================================================================

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-04-15";
const TIMEOUT_MS = 30_000;
/** Cuánto hacia atrás mira el job si no encuentra marca de agua. */
const DEFAULT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** Margen hacia atrás sobre la marca de agua, por si un mensaje llegó tarde. */
const SAFETY_MS = 15 * 60 * 1000;

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY ?? ""}`,
    Version: VERSION,
    Accept: "application/json",
  };
}

/** GET con reintentos: GHL corta conexiones cada tanto. */
async function get(url: string, intentos = 3): Promise<Response | null> {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, {
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) return r;
      if (r.status === 429) {
        await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
        continue;
      }
      return null;
    } catch {
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
  return null;
}

interface GhlConversation {
  id: string;
  contactId?: string;
  lastMessageDate?: number;
}

interface GhlMessage {
  id?: string;
  direction?: string;
  body?: string;
  dateAdded?: string;
}

/** Huella del texto para comparar: sin emojis ni signos, primeros 70 caracteres. */
function huella(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

/**
 * Conversaciones de GHL con actividad desde `sinceMs`, de la más reciente a la
 * más vieja. Corta en cuanto encuentra una anterior a la marca.
 */
async function conversacionesConActividad(
  locationId: string,
  sinceMs: number,
  maxPaginas = 20,
): Promise<GhlConversation[]> {
  const out: GhlConversation[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < maxPaginas; page++) {
    const u = new URL(`${BASE}/conversations/search`);
    u.searchParams.set("locationId", locationId);
    u.searchParams.set("limit", "100");
    u.searchParams.set("sortBy", "last_message_date");
    u.searchParams.set("sort", "desc");
    if (cursor !== null) u.searchParams.set("startAfterDate", String(cursor));
    const r = await get(u.toString());
    if (!r) break;
    const j = (await r.json()) as { conversations?: GhlConversation[] };
    const lote = j.conversations ?? [];
    if (!lote.length) break;
    let corto = false;
    for (const c of lote) {
      if ((c.lastMessageDate ?? 0) < sinceMs) {
        corto = true;
        break;
      }
      out.push(c);
    }
    if (corto) break;
    const ultima = lote[lote.length - 1]?.lastMessageDate;
    if (!ultima || ultima === cursor) break;
    cursor = ultima;
  }
  return out;
}

/** Mensajes de una conversación de GHL (los 100 más recientes alcanzan). */
async function mensajesDeConversacion(convId: string): Promise<GhlMessage[]> {
  const r = await get(`${BASE}/conversations/${convId}/messages?limit=100`);
  if (!r) return [];
  const j = (await r.json()) as { messages?: { messages?: GhlMessage[] } };
  return j.messages?.messages ?? [];
}

export interface ImportResult {
  conversacionesRevisadas: number;
  mensajesImportados: number;
  desde: string;
  error?: string;
}

/**
 * Importa a `messages` (role="human") los salientes que escribió el equipo
 * desde GoHighLevel. Idempotente: deduplica por external_id.
 */
export async function importarMensajesDelEquipo(
  // El cliente de Supabase se inyecta: la ruta pasa el del servidor (RLS por
  // client_slug) y el script de backfill pasa el de service role.
  // El cliente tipado del panel y el de service role del script no comparten
  // el genérico de Database, así que acá se acepta cualquiera de los dos.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  opts?: {
    /** Desde cuándo mirar. Por defecto, el último mensaje humano guardado. */
    sinceMs?: number;
    /** Tope de conversaciones por corrida, para no pasarse del tiempo de función. */
    maxConversaciones?: number;
    /**
     * client_slug a escribir. La ruta lo omite: el cliente con JWT scopeado deja
     * que la base lo complete sola. El script de backfill usa service role, que
     * no lleva ese claim, así que tiene que pasarlo o el insert viola el NOT NULL.
     */
    clientSlug?: string;
  },
): Promise<ImportResult> {
  const locationId = process.env.NEXT_PUBLIC_GHL_LOCATION_ID;
  if (!process.env.GHL_API_KEY || !locationId) {
    return {
      conversacionesRevisadas: 0,
      mensajesImportados: 0,
      desde: new Date(0).toISOString(),
      error: "Falta GHL_API_KEY o NEXT_PUBLIC_GHL_LOCATION_ID",
    };
  }
  // Marca de agua: el último mensaje humano que ya tenemos.
  let sinceMs = opts?.sinceMs;
  if (sinceMs === undefined) {
    const { data: ultimo } = await sb
      .from("messages")
      .select("created_at")
      .eq("role", "human")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    sinceMs = ultimo?.created_at
      ? new Date(ultimo.created_at).getTime() - SAFETY_MS
      : Date.now() - DEFAULT_LOOKBACK_MS;
  }

  // Huellas de TODO lo que mandamos nosotros en el último mes. Hace falta el
  // set global, no solo el de la conversación: los textos de plantilla (el aviso
  // de pago verificado, la presentación) salen iguales en muchas conversaciones,
  // y si lo que guardamos difiere de lo que salió (pasa durante un deploy, con
  // dos versiones del texto conviviendo), el match por conversación no alcanza y
  // terminamos marcando como "del equipo" un mensaje nuestro.
  const huellasGlobales = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("messages")
      .select("content")
      .in("role", ["assistant", "system"])
      .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const m of data) {
      for (const parte of String(m.content ?? "").split("---")) {
        const h = huella(parte);
        if (h.length > 12) huellasGlobales.add(h);
      }
    }
    if (data.length < 1000) break;
  }

  const convs = await conversacionesConActividad(locationId, sinceMs);
  const limitadas = opts?.maxConversaciones
    ? convs.slice(0, opts.maxConversaciones)
    : convs;

  let importados = 0;
  for (const gc of limitadas) {
    if (!gc.contactId) continue;
    const { data: conv } = await sb
      .from("conversations")
      .select("id, updated_at")
      .eq("external_id", gc.contactId)
      .eq("source", "whatsapp")
      .maybeSingle();
    if (!conv) continue;

    // Lo que ya tenemos de esta conversación: ids de GHL guardados y huellas de
    // nuestros propios salientes, para no importar como humano algo nuestro.
    const { data: nuestras } = await sb
      .from("messages")
      .select("role, content, external_id, created_at")
      .eq("conversation_id", conv.id)
      .gte("created_at", new Date(sinceMs - 86_400_000).toISOString());
    const idsConocidos = new Set<string>();
    const huellasNuestras = new Set<string>();
    for (const m of nuestras ?? []) {
      if (m.external_id) idsConocidos.add(m.external_id);
      if (m.role === "assistant" || m.role === "system") {
        // Las respuestas multi burbuja se parten por ---: cada tramo es un envío.
        for (const parte of (m.content ?? "").split("---")) {
          const h = huella(parte);
          if (h.length > 12) huellasNuestras.add(h);
        }
      }
    }

    for (const m of await mensajesDeConversacion(gc.id)) {
      if (!m.dateAdded || !m.id) continue;
      if ((m.direction ?? "").toLowerCase() !== "outbound") continue;
      const t = new Date(m.dateAdded).getTime();
      if (t < sinceMs) continue;
      if (idsConocidos.has(m.id)) continue;
      const texto = (m.body ?? "").trim();
      if (!texto) continue;
      const h = huella(texto);
      if (h.length > 12 && (huellasNuestras.has(h) || huellasGlobales.has(h))) continue;

      // Dedup final contra la base: la ventana de cada corrida se solapa con la
      // anterior a propósito, y dos corridas pueden encimarse. El índice único
      // de la migración 031 es el cinturón; esto son los tiradores.
      const { data: yaEsta } = await sb
        .from("messages")
        .select("id")
        .eq("external_id", m.id)
        .maybeSingle();
      if (yaEsta) continue;

      const fila: Record<string, unknown> = {
        conversation_id: conv.id,
        role: "human",
        content: texto,
        external_id: m.id,
        created_at: new Date(t).toISOString(),
      };
      if (opts?.clientSlug) fila.client_slug = opts.clientSlug;
      const { error } = await sb.from("messages").insert(fila);
      // Violación de unicidad = ya lo teníamos; cualquier otro error se ignora
      // (el importador es best-effort, corre de nuevo en la próxima pasada).
      if (!error) {
        importados++;
        if (new Date(conv.updated_at).getTime() < t) {
          await sb
            .from("conversations")
            .update({ updated_at: new Date(t).toISOString() })
            .eq("id", conv.id);
        }
      }
    }
  }

  return {
    conversacionesRevisadas: limitadas.length,
    mensajesImportados: importados,
    desde: new Date(sinceMs).toISOString(),
  };
}
