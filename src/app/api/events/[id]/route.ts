import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { eventInputSchema } from "@/lib/events/schema";

export const dynamic = "force-dynamic";

// PATCH: edición total de un evento (el form manda todos los campos).
// DELETE: borra el evento.
// RLS garantiza que solo se toque un evento del propio cliente.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "No se encontró el evento" },
      { status: error ? 500 : 404 },
    );
  }
  return NextResponse.json({ id: data.id }, { status: 200 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getSupabaseServerClient();
  const { error } = await sb.from("events").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
