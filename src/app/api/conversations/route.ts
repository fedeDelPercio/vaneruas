import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/conversations — lista conversaciones (mas recientes primero).
export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data });
}

const createSchema = z.object({
  display_name: z.string().min(1).max(120),
  created_by: z.string().uuid().nullable().optional(),
  // Solo para source=test: simula el "ahora" del cliente y si ya está
  // registrado en el CRM (Kommo). En producción, ambos campos los maneja la
  // integración Kommo aparte.
  simulated_timestamp: z.string().datetime({ offset: true }).nullable().optional(),
  is_existing_customer: z.boolean().optional(),
});

// POST /api/conversations — crea una conversación de prueba.
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
    .from("conversations")
    .insert({
      display_name: parsed.data.display_name,
      source: "test",
      created_by: parsed.data.created_by ?? null,
      simulated_timestamp: parsed.data.simulated_timestamp ?? null,
      is_existing_customer: parsed.data.is_existing_customer ?? false,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data }, { status: 201 });
}
