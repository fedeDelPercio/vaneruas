import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/profiles — lista todos los perfiles.
export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profiles: data });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.enum(["dev", "client", "asesor"]),
});

// POST /api/profiles — crea un perfil.
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
    .from("profiles")
    .insert(parsed.data)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe un perfil con ese nombre" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data }, { status: 201 });
}
