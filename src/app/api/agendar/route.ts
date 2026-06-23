import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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
  const status = req.nextUrl.searchParams.get("status") ?? "pending";

  let query = sb
    .from("conversations")
    .select("id, display_name, source, external_id, wa_jid, agendada, created_at, updated_at")
    .eq("source", "whatsapp")
    // Más recientes primero: el contacto que acaba de escribir es el que hay
    // que agendar ahora.
    .order("updated_at", { ascending: false })
    .limit(MAX_ITEMS);

  if (status === "pending") query = query.eq("agendada", false);
  else if (status === "done") query = query.eq("agendada", true);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows?.length) {
    return NextResponse.json({ items: [] satisfies AgendarItem[] });
  }

  // Últimos mensajes del contacto por conversación (donde suele estar el nombre
  // y apellido que pidió el agente). Traemos hasta 2 por conversación.
  const convIds = rows.map((r) => r.id);
  const { data: userMsgs } = await sb
    .from("messages")
    .select("conversation_id, content, created_at")
    .in("conversation_id", convIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(600);
  const messagesByConv = new Map<string, string[]>();
  for (const m of userMsgs ?? []) {
    if (!m.conversation_id) continue;
    const text = (m.content ?? "").trim();
    if (!text || text.startsWith("[")) continue;
    const arr = messagesByConv.get(m.conversation_id) ?? [];
    if (arr.length < 2) arr.push(text);
    messagesByConv.set(m.conversation_id, arr);
  }

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

  return NextResponse.json({ items });
}
