import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ghlSendAllowed, ghlSendWhatsApp, ghlSetPauseTag } from "@/lib/providers/ghl";
import { clientEnv } from "@/lib/env";
import { resolveTeamInterventions } from "@/lib/team-interventions";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// POST /api/wa/messages/[conversationId]   Body: { content }
//
// Mensaje que escribe una persona del equipo desde el chat del panel. Sale por
// WhatsApp vía GoHighLevel (el mismo camino que usa Valentina) y queda
// guardado como role="human".
//
// Antes, el cuadro de texto del chat de WhatsApp era el del banco de pruebas:
// lo que se escribía entraba como si lo hubiera dicho la CLIENTA y Valentina
// le contestaba a la persona real. Este endpoint es el envío de verdad.
//
// Reglas:
//  - Solo conversaciones de WhatsApp con contacto de GHL.
//  - La conversación tiene que estar en modo Humano: si Valentina sigue
//    activa, contestaría encima del equipo en el próximo mensaje.
//  - Respeta GHL_SEND_ALLOWLIST (en local solo salen los contactos de prueba).
//  - Guardamos el id que devuelve GHL en external_id: el importador de
//    mensajes del equipo lo reconoce y no lo duplica.
//  - Si el mensaje salió, las intervenciones abiertas de la conversación se
//    resuelven solas (src/lib/team-interventions.ts), con `resolved_by` = el
//    perfil que escribió si el panel lo manda. Si falla la resolución el envío
//    igual se informa como ok (reintentar duplicaría el mensaje).
// ===========================================================================

const bodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
  /** Perfil del panel que escribe (para `resolved_by`). Opcional. */
  profileId: z.string().uuid().optional().nullable(),
});

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
    return NextResponse.json({ error: "El mensaje está vacío o es demasiado largo" }, { status: 400 });
  }
  const content = parsed.data.content;
  const profileId = parsed.data.profileId ?? null;
  const sb = getSupabaseServerClient();

  const { data: conv, error: convErr } = await sb
    .from("conversations")
    .select("id, source, external_id, mode")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 });
  if (!conv) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  if (conv.source !== "whatsapp") {
    return NextResponse.json({ error: "Esta conversación no es de WhatsApp" }, { status: 400 });
  }
  const contactId = conv.external_id?.trim();
  if (!contactId) {
    return NextResponse.json(
      { error: "La conversación no tiene contacto de GoHighLevel asociado" },
      { status: 400 },
    );
  }
  if (conv.mode !== "HUMAN") {
    return NextResponse.json(
      { error: "Tomá la conversación (modo Humano) antes de escribir" },
      { status: 409 },
    );
  }
  if (!ghlSendAllowed(contactId)) {
    return NextResponse.json(
      {
        error:
          "Este entorno no tiene habilitado el envío a este contacto (lista de envío permitida)",
      },
      { status: 403 },
    );
  }

  let ghlMessageId: string | null;
  try {
    ghlMessageId = await ghlSendWhatsApp(contactId, content);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[wa/messages] envío falló:", detail);
    // Tres casos distintos, con consecuencias distintas para quien escribe:
    //  - GHL contestó con un error (el texto empieza con "GHL send <código>"):
    //    el mensaje NO salió. Lo más común es la ventana de 24 hs.
    //  - Falta configuración: tampoco salió, y no tiene que ver con las 24 hs.
    //  - Cualquier otra cosa (timeout, corte de red): no se sabe si salió.
    //    Reenviar a ciegas puede hacer que la clienta lo reciba dos veces.
    const rejected = /^GHL send \d{3}/.test(detail);
    const misconfigured = /no configurada/i.test(detail);
    const uncertain = !rejected && !misconfigured;
    return NextResponse.json(
      {
        error: uncertain
          ? "No se pudo confirmar si el mensaje salió. Antes de reenviarlo, fijate en GoHighLevel: acá puede tardar unos minutos en aparecer"
          : misconfigured
            ? "El envío por WhatsApp no está configurado en este entorno"
            : "GoHighLevel rechazó el envío, el mensaje no salió. Si pasaron más de 24 hs del último mensaje de la clienta, WhatsApp no deja escribirle",
        detail: detail.slice(0, 300),
        uncertain,
      },
      { status: 502 },
    );
  }

  // Escribir es tomar la conversación: se asegura el tag de pausa en GHL. Sin
  // esto, una conversación que quedó en Humano por el interruptor general (que
  // no pone tags) volvía a manos de Valentina cuando alguien reactivaba la IA
  // para todos, aunque el equipo estuviera en plena charla.
  const tagSync = ghlSetPauseTag(contactId, true);

  // El importador de mensajes del equipo pudo haber traído este mismo mensaje
  // en el instante entre el envío y este guardado: si ya está, no se duplica.
  if (ghlMessageId) {
    const { data: existing } = await sb
      .from("messages")
      .select("*")
      .eq("external_id", ghlMessageId)
      .maybeSingle();
    if (existing) {
      const ghlSynced = await tagSync;
      const pendingResolved = await resolveAfterReply(conversationId, profileId);
      return NextResponse.json({ ok: true, message: existing, stored: true, ghlSynced, pendingResolved });
    }
  }

  const { data: msg, error: msgErr } = await sb
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "human",
      content,
      external_id: ghlMessageId,
      delivered_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  await sb
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  const ghlSynced = await tagSync;

  // El mensaje salió: lo que el equipo tenía pendiente en esta conversación
  // quedó atendido.
  const pendingResolved = await resolveAfterReply(conversationId, profileId);

  if (msgErr || !msg) {
    // El mensaje YA salió por WhatsApp. No es un error de envío: el importador
    // de mensajes del equipo lo va a traer de GHL en su próxima pasada.
    console.error("[wa/messages] enviado pero no guardado:", msgErr?.message);
    return NextResponse.json({ ok: true, message: null, stored: false, ghlSynced, pendingResolved });
  }
  return NextResponse.json({ ok: true, message: msg, stored: true, ghlSynced, pendingResolved });
}

async function resolveAfterReply(conversationId: string, profileId: string | null): Promise<boolean> {
  const { error } = await resolveTeamInterventions(getSupabaseServerClient(), {
    conversationId,
    clientSlug: clientEnv.NEXT_PUBLIC_CLIENT_SLUG,
    resolvedBy: profileId,
  });
  if (error) console.error("[wa/messages] no se pudo resolver la intervención:", error);
  return !error;
}
