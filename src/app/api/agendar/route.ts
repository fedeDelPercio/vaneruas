import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { matchesContactQuery } from "@/lib/search";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/agendar?status=pending|done|all
//
// Worklist del módulo Agendar: contactos de WhatsApp que el equipo todavía
// tiene que dar de alta (en GHL y, según el caso, en grupos de WhatsApp). El
// agente les pide nombre y apellido en la conversación; el equipo lo lee del
// chat, los registra y los tilda como agendados.
//
//  - pending (default): conversaciones con agendada = false.
//  - done: ya agendadas.
//  - all: todas.
//
// Devuelve nombre, teléfono, contactId de GHL y el último mensaje del contacto
// (donde suele estar el nombre y apellido que pidió el agente). RLS aísla por
// cliente vía el JWT.
// ===========================================================================

const MAX_ITEMS = 300;

export interface AgendarItem {
  conversationId: string;
  displayName: string;
  phone: string | null;
  externalId: string | null;
  source: string;
  agendada: boolean;
  /** Últimos mensajes del contacto (el más reciente primero), para leer el nombre. */
  lastMessages: string[];
  createdAt: string;
  updatedAt: string;
}

export async function GET(req: NextRequest) {
  const sb = getSupabaseServerClient();
  // Con búsqueda se busca en TODOS los contactos del estado pedido, no solo en
  // los que entran en el tope de la lista.
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  let total = 0;
  const status = req.nextUrl.searchParams.get("status") ?? "pending";

  // El módulo Agendar es SOLO para quienes mandaron un comprobante de pago (no
  // para cualquier contacto que consulta). Primero juntamos las conversaciones
  // que tienen al menos un comprobante; el listado se acota a esas.
  //
  // OJO con cómo se cruzan las dos tablas. Antes se pasaban los ids de esas
  // conversaciones en un `.in("id", [...])`: con cientos de comprobantes la
  // lista viaja en la URL, se pasa del tamaño máximo y el pedido falla
  // ("fetch failed"), dejando el módulo vacío. Ahora se traen las dos listas
  // paginadas y se cruzan en memoria.
  let rows: {
    id: string;
    display_name: string;
    source: string;
    external_id: string | null;
    wa_jid: string | null;
    agendada: boolean;
    created_at: string;
    updated_at: string;
  }[];
  try {
    const payRows = await fetchAllRows((from, to) =>
      sb
        .from("payment_validations")
        .select("id, conversation_id")
        .not("conversation_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const withComprobante = new Set(
      payRows.map((r) => r.conversation_id).filter(Boolean) as string[],
    );
    if (!withComprobante.size) {
      return NextResponse.json({ items: [] satisfies AgendarItem[] });
    }
    const convRows = await fetchAllRows((from, to) => {
      let query = sb
        .from("conversations")
        .select("id, display_name, source, external_id, wa_jid, agendada, created_at, updated_at")
        .eq("source", "whatsapp");
      if (status === "pending") query = query.eq("agendada", false);
      else if (status === "done") query = query.eq("agendada", true);
      // Más recientes primero: el contacto que acaba de escribir es el que hay
      // que agendar ahora.
      return query
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    });
    const matched = convRows.filter(
      (c) =>
        withComprobante.has(c.id) &&
        matchesContactQuery(q, { texts: [c.display_name], phones: [c.wa_jid] }),
    );
    total = matched.length;
    rows = matched.slice(0, MAX_ITEMS);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo cargar la lista" },
      { status: 500 },
    );
  }
  if (!rows.length) {
    return NextResponse.json({ items: [] satisfies AgendarItem[], total });
  }

  // Últimos mensajes del contacto por conversación (donde suele estar el nombre
  // y apellido que pidió el agente). Traemos hasta 2 por conversación.
  const convIds = rows.map((r) => r.id);
  // De a 50 conversaciones por consulta (los ids viajan en la URL).
  const idChunks: string[][] = [];
  for (let i = 0; i < convIds.length; i += 50) idChunks.push(convIds.slice(i, i + 50));
  const msgResults = await Promise.all(
    idChunks.map((chunk) =>
      sb
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", chunk)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(300),
    ),
  );
  const messagesByConv = new Map<string, string[]>();
  const collect = (m: { conversation_id: string | null; content: string | null }) => {
    if (!m.conversation_id) return;
    const text = (m.content ?? "").trim();
    if (!text || text.startsWith("[")) return;
    const arr = messagesByConv.get(m.conversation_id) ?? [];
    if (arr.length < 2) arr.push(text);
    messagesByConv.set(m.conversation_id, arr);
  };
  // Tandas que llegaron al tope: los mensajes de las conversaciones menos
  // recientes pudieron quedar afuera y la tarjeta saldría sin el nombre.
  const incomplete: string[] = [];
  msgResults.forEach((r, i) => {
    for (const m of r.data ?? []) collect(m);
    if ((r.data ?? []).length >= 300) {
      for (const id of idChunks[i] ?? []) {
        if ((messagesByConv.get(id) ?? []).length < 2) incomplete.push(id);
      }
    }
  });
  // Para esas, una consulta puntual por conversación.
  await Promise.all(
    incomplete.map(async (id) => {
      const { data } = await sb
        .from("messages")
        .select("conversation_id, content, created_at")
        .eq("conversation_id", id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(12);
      messagesByConv.delete(id);
      for (const m of data ?? []) collect(m);
    }),
  );

  const items: AgendarItem[] = rows.map((r) => ({
    conversationId: r.id,
    displayName: r.display_name ?? "(sin nombre)",
    phone: r.wa_jid ?? null,
    externalId: r.external_id ?? null,
    source: r.source,
    agendada: r.agendada,
    lastMessages: messagesByConv.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({ items, total });
}
