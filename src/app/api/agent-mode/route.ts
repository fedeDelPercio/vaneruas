import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET / PATCH /api/agent-mode
//
// Switch GLOBAL Humano <-> IA para todas las conversaciones de WhatsApp del
// cliente. Es el "interruptor general" del agente: en un evento con mucha
// consulta puntual conviene apagar a la IA y que atienda todo el equipo, y
// volver a encenderla después.
//
// Cómo funciona: el worker (/api/jobs/process) NO responde cuando la
// conversación está en mode='HUMAN'. Este endpoint setea ese campo en masa.
//
// OJO: esto NO toca los tags de GoHighLevel. El switch por tag
// (/api/webhooks/ghl/mode) sigue existiendo y actúa por contacto: si alguien
// agrega/quita el tag de pausa en GHL, esa conversación puntual se recalcula.
// El botón global es el que manda para el resto.
// ===========================================================================

const patchSchema = z.object({ mode: z.enum(["AI", "HUMAN"]) });

/** Estado actual: cuántas conversaciones hay de cada lado. */
export async function GET() {
  const sb = getSupabaseServerClient();
  const { count: human } = await sb
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("source", "whatsapp")
    .eq("mode", "HUMAN");
  const { count: ai } = await sb
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("source", "whatsapp")
    .eq("mode", "AI");

  const humanCount = human ?? 0;
  const aiCount = ai ?? 0;
  // El modo "efectivo" es el de la mayoría: sirve para pintar el botón.
  const mode = humanCount > aiCount ? "HUMAN" : "AI";
  return NextResponse.json({ mode, human: humanCount, ai: aiCount });
}

/** Aplica el modo a TODAS las conversaciones de WhatsApp. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Modo inválido (AI | HUMAN)" }, { status: 400 });
  }
  const { mode } = parsed.data;

  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("conversations")
    .update({ mode, updated_at: new Date().toISOString() })
    .eq("source", "whatsapp")
    .neq("mode", mode)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, mode, updated: data?.length ?? 0 });
}
