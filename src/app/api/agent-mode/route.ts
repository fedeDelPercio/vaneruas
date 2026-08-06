import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { ghlContactsWithPauseTag } from "@/lib/providers/ghl";

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

  let query = sb
    .from("conversations")
    .update({ mode, updated_at: new Date().toISOString() })
    .eq("source", "whatsapp")
    .neq("mode", mode);

  // Al ENCENDER la IA respetamos a quienes el equipo marcó a mano en GHL con el
  // tag de pausa: esos siguen en atención humana. (Al APAGAR no hace falta:
  // apagar es más restrictivo y aplica a todos.)
  let excluded = 0;
  let ghlWarning: string | null = null;
  if (mode === "AI") {
    const loc = clientEnv.NEXT_PUBLIC_GHL_LOCATION_ID;
    const paused = loc ? await ghlContactsWithPauseTag(loc) : null;
    if (paused === null) {
      // No pudimos consultar GHL. Encendemos igual (el equipo puede volver a
      // pausar), pero lo avisamos: puede haber contactos marcados que queden
      // con la IA activa.
      ghlWarning =
        "No se pudo consultar GoHighLevel: puede que se haya activado la IA en contactos marcados como humano";
    } else if (paused.length) {
      excluded = paused.length;
      // PostgREST: excluir por lista de external_id (contact_id de GHL).
      query = query.not(
        "external_id",
        "in",
        `(${paused.map((id) => `"${id}"`).join(",")})`,
      );
    }
  }

  const { data, error } = await query.select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    mode,
    updated: data?.length ?? 0,
    excluded,
    warning: ghlWarning,
  });
}
