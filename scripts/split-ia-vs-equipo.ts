// Reparto real de la atencion: cuanto contesta la IA y cuanto el equipo.
//
// OJO: en este cliente la DB del panel NO guarda los salientes que escribe una
// persona desde GoHighLevel (no esta instalada la app con el webhook
// OutboundMessage, el inbound llega por workflow). Asi que el reparto se
// reconstruye leyendo los mensajes de la API de GHL y atribuyendo cada saliente:
//
//   - id en nuestros external_id              -> lo mando el agente
//   - el texto coincide con un saliente nuestro guardado en la DB -> nuestro
//     (cubre lo que sale del panel, ej. "tu pago quedo verificado", donde no
//      guardamos el messageId de GHL)
//   - el resto                                -> lo escribio el equipo
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GHL_API_KEY=... \
//   NEXT_PUBLIC_GHL_LOCATION_ID=... npx tsx scripts/split-ia-vs-equipo.ts 2026-09-13
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PIT = process.env.GHL_API_KEY!;
const LOC = process.env.NEXT_PUBLIC_GHL_LOCATION_ID!;
const BASE = "https://services.leadconnectorhq.com";
const H = { Authorization: `Bearer ${PIT}`, Version: "2021-04-15", Accept: "application/json" };
const DESDE = process.argv[2] ?? "2026-10-06";
// Red de conversaciones a revisar. Mas amplia que DESDE a proposito: si el
// equipo escribio y la contacta no contesto, updated_at no se movio y la
// conversacion no aparece como "activa" en el periodo.
const RED = process.argv[3] ?? "2026-09-13";

interface Raw { id?: string; direction?: string; body?: string; dateAdded?: string; status?: string }

/** GHL corta conexiones cada tanto: reintentamos antes de dar por perdida la conversacion. */
async function get(url: string | URL, intentos = 3): Promise<Response | null> {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(45000) });
      if (r.ok) return r;
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 2000 * (i + 1))); continue; }
      return null;
    } catch {
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
  return null;
}

/** Huella del texto para comparar: sin emojis, sin signos, primeros 70 chars. */
function huella(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

const dia = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);

async function convMessages(convId: string): Promise<Raw[]> {
  const out: Raw[] = [];
  let lastId: string | undefined;
  for (let i = 0; i < 8; i++) {
    const u = new URL(`${BASE}/conversations/${convId}/messages`);
    u.searchParams.set("limit", "100");
    if (lastId) u.searchParams.set("lastMessageId", lastId);
    const r = await get(u);
    if (!r) break;
    const j = (await r.json()) as { messages?: { messages?: Raw[]; nextPage?: boolean; lastMessageId?: string } };
    const box = j.messages;
    const lote = box?.messages ?? [];
    out.push(...lote);
    // La paginacion de GHL repite el ultimo id: si no avanza, cortamos (si no,
    // el mismo lote se cuenta varias veces).
    if (!box?.nextPage || !box?.lastMessageId || box.lastMessageId === lastId || !lote.length) break;
    lastId = box.lastMessageId;
  }
  // Dedup por id: la paginacion puede devolver el mismo mensaje dos veces.
  const vistos = new Set<string>();
  return out.filter((m) => {
    const k = m.id ?? `${m.dateAdded}|${m.body}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

async function main() {
  const { data: convs } = await sb
    .from("conversations")
    .select("id, display_name, external_id, ghl_conversation_id, mode")
    .eq("client_slug", "vanesaruas")
    .eq("source", "whatsapp")
    .gte("updated_at", `${RED}T03:00:00Z`)
    .order("updated_at", { ascending: false });
  console.log(`Ventana de mensajes desde ${DESDE} · conversaciones revisadas (activas desde ${RED}): ${convs?.length ?? 0}`);

  // Todo lo que salio de nuestro lado, por conversacion: id de GHL + huella.
  const idsNuestros = new Set<string>();
  const huellasPorConv = new Map<string, Set<string>>();
  const huellasGlobal = new Set<string>();
  // Momento de cada saliente nuestro: todo lo que mandamos deja fila en la DB,
  // asi que un saliente de GHL sin fila nuestra cerca en el tiempo lo escribio
  // una persona (en este cliente NO guardamos los salientes humanos).
  const tiemposPorConv = new Map<string, number[]>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("messages")
      .select("conversation_id, external_id, content, role, created_at")
      .in("role", ["assistant", "system"])
      .gte("created_at", `${DESDE}T00:00:00Z`)
      .order("created_at")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const m of data) {
      if (m.external_id) idsNuestros.add(m.external_id);
      const set = huellasPorConv.get(m.conversation_id) ?? new Set<string>();
      // Las respuestas multi burbuja se parten por ---: cada tramo es un envio.
      for (const parte of m.content.split("---")) {
        const h = huella(parte);
        if (h.length > 12) set.add(h);
      }
      huellasPorConv.set(m.conversation_id, set);
      for (const h of set) huellasGlobal.add(h);
      const ts = tiemposPorConv.get(m.conversation_id) ?? [];
      ts.push(new Date((m as { created_at: string }).created_at).getTime());
      tiemposPorConv.set(m.conversation_id, ts);
    }
    if (data.length < 1000) break;
  }

  let inb = 0, ia = 0, hum = 0, dudosos = 0;
  const porDia = new Map<string, { ia: number; hum: number; inb: number }>();
  const convConEquipo = new Set<string>();
  const humanos: { conv: string; nombre: string; fecha: string; body: string; previo: string }[] = [];

  for (const c of convs ?? []) {
    let gid = (c as { ghl_conversation_id?: string | null }).ghl_conversation_id ?? null;
    if (!gid && c.external_id) {
      const r = await get(`${BASE}/conversations/search?locationId=${encodeURIComponent(LOC)}&contactId=${encodeURIComponent(c.external_id)}`);
      if (r) gid = ((await r.json()) as { conversations?: { id: string }[] }).conversations?.[0]?.id ?? null;
    }
    if (!gid) continue;
    const nuestrasHuellas = huellasPorConv.get(c.id) ?? new Set<string>();
    const nuestrosTiempos = tiemposPorConv.get(c.id) ?? [];
    const orden = (await convMessages(gid))
      .filter((m) => m.dateAdded && dia(m.dateAdded) >= DESDE)
      .sort((a, b) => (a.dateAdded ?? "").localeCompare(b.dateAdded ?? ""));

    for (let i = 0; i < orden.length; i++) {
      const m = orden[i];
      if (!m?.dateAdded) continue;
      const d = dia(m.dateAdded);
      const acc = porDia.get(d) ?? { ia: 0, hum: 0, inb: 0 };
      if ((m.direction ?? "").toLowerCase() === "inbound") {
        inb++; acc.inb++;
      } else {
        const h = huella(m.body ?? "");
        const t = new Date(m.dateAdded).getTime();
        // Dudoso: no matchea texto pero salio a menos de 90s de un envio
        // nuestro. Lo contamos aparte como banda de incertidumbre.
        const cerca = nuestrosTiempos.some((x) => Math.abs(x - t) < 90_000);
        const esNuestro =
          (m.id && idsNuestros.has(m.id)) ||
          (h.length > 12 && (nuestrasHuellas.has(h) || huellasGlobal.has(h)));
        if (!esNuestro && cerca) dudosos++;
        if (esNuestro) { ia++; acc.ia++; }
        else {
          hum++; acc.hum++;
          convConEquipo.add(c.id);
          const previo = [...orden.slice(0, i)].reverse().find((x) => (x.direction ?? "").toLowerCase() === "inbound");
          humanos.push({
            conv: c.id,
            nombre: c.display_name ?? "?",
            fecha: m.dateAdded.slice(0, 16),
            body: (m.body ?? "").replace(/\s+/g, " ").slice(0, 220),
            previo: (previo?.body ?? "(sin mensaje previo)").replace(/\s+/g, " ").slice(0, 170),
          });
        }
      }
      porDia.set(d, acc);
    }
  }

  const tot = ia + hum;
  console.log(`\ninbound ${inb} · saliente IA ${ia} · saliente equipo ${hum}`);
  if (tot) console.log(`=> IA ${((ia / tot) * 100).toFixed(1)}%  ·  equipo ${((hum / tot) * 100).toFixed(1)}%`);
  console.log(`=> conversaciones tocadas por el equipo: ${convConEquipo.size} de ${convs?.length ?? 0} (${(((convConEquipo.size) / (convs?.length || 1)) * 100).toFixed(1)}%)`);

  console.log(`\ndia            IA   equipo  inbound   %IA`);
  for (const [d, a] of [...porDia].sort()) {
    const p = a.ia + a.hum ? ((a.ia / (a.ia + a.hum)) * 100).toFixed(0) : "-";
    console.log(`${d} ${String(a.ia).padStart(6)} ${String(a.hum).padStart(8)} ${String(a.inb).padStart(8)} ${p.padStart(5)}%`);
  }

  console.log(`\n--- Intervenciones del equipo (${humanos.length})\n`);
  for (const h of humanos.sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    console.log(`${h.fecha}  ${h.nombre}`);
    console.log(`   cliente: ${h.previo}`);
    console.log(`   equipo : ${h.body}`);
    console.log(`   https://vaneruas.vercel.app/wa?c=${h.conv}\n`);
  }
}
void main();
