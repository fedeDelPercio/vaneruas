import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ghlFindConversationId } from "@/lib/providers/ghl";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/ghl/conversation?c={conversationId interno}
//
// Redirige al thread EXACTO de la conversación en GoHighLevel. El panel ("Ver
// conversación" en Aprobaciones / Derivaciones / Certificados) abre este
// endpoint en una pestaña nueva; acá resolvemos el conversationId de GHL del
// contacto (su API lo identifica por contacto) y redirigimos a la URL del
// thread. La URL de conversaciones de GHL usa SU conversationId, no el
// contactId, por eso no se puede armar el link directo en el cliente.
//
// Fallbacks (siempre redirige a algo razonable, nunca rompe):
//  - sin conversationId de GHL → página del contacto en GHL,
//  - sin contacto / no es WhatsApp / sin locationId → bandeja de conversaciones
//    de GHL, o el visor interno si GHL no está configurado.
// ===========================================================================

const GHL_APP_BASE = "https://app.gohighlevel.com/v2/location";

export async function GET(req: NextRequest) {
  const convId = req.nextUrl.searchParams.get("c");
  const locationId = process.env.NEXT_PUBLIC_GHL_LOCATION_ID ?? "";

  // Sin locationId no hay forma de armar ninguna URL de GHL: caemos al visor
  // interno del panel.
  if (!locationId) {
    return NextResponse.redirect(
      new URL(convId ? `/conversations?id=${convId}` : "/wa", req.nextUrl.origin),
    );
  }

  // La bandeja de conversaciones de GHL necesita estos query params para
  // renderizar el thread dentro de la vista correcta (sin ellos abre la bandeja
  // pero no selecciona/muestra la conversación).
  const INBOX_QS = "?category=team-inbox&tab=all";
  const inboxUrl = `${GHL_APP_BASE}/${locationId}/conversations/conversations${INBOX_QS}`;
  if (!convId) return NextResponse.redirect(inboxUrl);

  const sb = getSupabaseServerClient();
  const { data: conv } = await sb
    .from("conversations")
    .select("external_id, source")
    .eq("id", convId)
    .maybeSingle();

  const contactId = conv?.external_id?.trim();
  if (!contactId || conv?.source !== "whatsapp") {
    return NextResponse.redirect(inboxUrl);
  }

  const ghlConvId = await ghlFindConversationId(contactId, locationId);
  // Cache-on-read: si lo resolvimos, lo guardamos para que el próximo click use
  // el link directo (sin volver a resolver). Best-effort, no bloquea el redirect.
  if (ghlConvId) {
    await sb
      .from("conversations")
      .update({ ghl_conversation_id: ghlConvId })
      .eq("id", convId)
      .is("ghl_conversation_id", null);
  }
  const target = ghlConvId
    ? `${GHL_APP_BASE}/${locationId}/conversations/conversations/${ghlConvId}${INBOX_QS}`
    : `${GHL_APP_BASE}/${locationId}/contacts/detail/${contactId}`;
  return NextResponse.redirect(target);
}
