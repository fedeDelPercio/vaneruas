import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { eventInputSchema } from "@/lib/events/schema";

export const dynamic = "force-dynamic";

// ===========================================================================
// /api/events — catálogo de eventos (masterclass / congreso).
//
// GET: lista TODOS los eventos del cliente (borrador, activo, archivado) para
//      el panel de administración.
// POST: crea un evento nuevo.
//
// El aislamiento por cliente lo enforce RLS (client_slug). El subconjunto que
// ve el AGENTE (solo 'activo' con lanzamiento cumplido) se resuelve aparte en
// `src/lib/agent/events-kb.ts`.
// ===========================================================================

export interface EventItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  announceAt: string | null;
  eventAt: string | null;
  eventEndAt: string | null;
  cardTotal: number | null;
  cardInstallments: number | null;
  transferPrice: number | null;
  internationalPrice: number | null;
  details: string | null;
  landingUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function toItem(r: {
  id: string;
  title: string;
  kind: string;
  status: string;
  announce_at: string | null;
  event_at: string | null;
  event_end_at: string | null;
  card_total: number | null;
  card_installments: number | null;
  transfer_price: number | null;
  international_price: number | null;
  details: string | null;
  landing_url: string | null;
  created_at: string;
  updated_at: string;
}): EventItem {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    announceAt: r.announce_at,
    eventAt: r.event_at,
    eventEndAt: r.event_end_at,
    cardTotal: r.card_total,
    cardInstallments: r.card_installments,
    transferPrice: r.transfer_price,
    internationalPrice: r.international_price,
    details: r.details,
    landingUrl: r.landing_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET() {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("events")
    .select("*")
    .order("event_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: (data ?? []).map(toItem) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = eventInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const v = parsed.data;
  const sb = getSupabaseServerClient();

  const { data, error } = await sb
    .from("events")
    .insert({
      title: v.title,
      kind: v.kind,
      status: v.status,
      announce_at: v.announceAt ?? null,
      event_at: v.eventAt ?? null,
      event_end_at: v.eventEndAt ?? null,
      card_total: v.cardTotal ?? null,
      card_installments: v.cardInstallments ?? null,
      transfer_price: v.transferPrice ?? null,
      international_price: v.internationalPrice ?? null,
      details: v.details ?? null,
      landing_url: v.landingUrl || null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "No se pudo crear el evento" },
      { status: 500 },
    );
  }
  return NextResponse.json({ item: toItem(data) }, { status: 201 });
}
