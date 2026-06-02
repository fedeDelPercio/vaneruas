import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const OUTBOUND_EVENTS = [
  "message.received",
  "agent.responded",
  "agent.escalated",
  "agent.failed",
] as const;

// GET /api/outbound-webhooks — lista los webhooks salientes.
export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("outbound_webhooks")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhooks: data });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  events: z.array(z.enum(OUTBOUND_EVENTS)).min(1),
  secret: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
});

// POST /api/outbound-webhooks — crea un webhook saliente.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("outbound_webhooks")
    .insert({
      name: parsed.data.name,
      url: parsed.data.url,
      events: parsed.data.events,
      secret: parsed.data.secret ?? null,
      active: parsed.data.active ?? true,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhook: data }, { status: 201 });
}
