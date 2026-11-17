import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ghlSendAllowed, ghlSetPauseTag } from "@/lib/providers/ghl";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// POST /api/wa/mode/[conversationId]   Body: { mode: "AI" | "HUMAN" }
//
// Cambia quién atiende UNA conversación: Valentina (AI) o el equipo (HUMAN).
// El worker ya respeta conversations.mode, así que aplica desde el próximo
// mensaje de la clienta.
//
// Además sincroniza el tag de pausa en GoHighLevel, para que el estado sea el
// mismo en los dos lados (ver ghlSetPauseTag). Si GHL no responde, el modo
// queda guardado igual y se avisa con `ghlSynced: false`.
//
// Tomar una conversación (HUMAN) respeta GHL_SEND_ALLOWLIST, igual que el
// envío: si este entorno no puede escribirle a ese contacto, tomarla solo
// dejaría a la clienta sin Valentina y sin nadie que le conteste desde acá.
// En producción la lista es "*" y no cambia nada; en local (que apunta a la
// base real) evita pausar a una clienta de verdad por probar el botón.
// Devolver a Valentina (AI) se permite siempre.
// ===========================================================================

const bodySchema = z.object({ mode: z.enum(["AI", "HUMAN"]) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Modo inválido (AI | HUMAN)" }, { status: 400 });
  }
  const { mode } = parsed.data;
  const sb = getSupabaseServerClient();

  if (mode === "HUMAN") {
    const { data: current, error: readErr } = await sb
      .from("conversations")
      .select("source, external_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    if (!current) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    const contactId = current.external_id?.trim();
    if (current.source === "whatsapp" && (!contactId || !ghlSendAllowed(contactId))) {
      return NextResponse.json(
        {
          error:
            "Este entorno no tiene habilitado escribirle a este contacto, así que no se puede tomar la conversación desde acá",
        },
        { status: 403 },
      );
    }
  }

  // Sin tocar updated_at: cambiar el modo no es actividad de la conversación
  // y no tiene que moverla al tope de la lista.
  const { data: conv, error } = await sb
    .from("conversations")
    .update({ mode })
    .eq("id", conversationId)
    .select("id, source, external_id, mode")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!conv) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  let ghlSynced: boolean | null = null;
  const contactId = conv.external_id?.trim();
  if (conv.source === "whatsapp" && contactId) {
    ghlSynced = await ghlSetPauseTag(contactId, mode === "HUMAN");
    // Un segundo intento: si el tag no queda, los dos lados dicen cosas
    // distintas (ver el aviso que muestra el chat en ese caso).
    if (!ghlSynced) ghlSynced = await ghlSetPauseTag(contactId, mode === "HUMAN");
  }

  return NextResponse.json({ ok: true, mode, ghlSynced });
}
