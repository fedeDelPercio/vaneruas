import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/ghl/conversation?c={conversationId interno}
//
// Redirige a la conversación del contacto en GoHighLevel. Hoy el panel arma el
// link directo a la ficha del contacto en el cliente (ver `ghl-link.ts`), así
// que este endpoint quedó como respaldo para pestañas con build viejo que
// todavía lo llamen. Redirige a la FICHA DEL CONTACTO (`/contacts/detail/{id}`),
// no al thread de conversación: el deep-link directo al thread no es confiable
// (el SPA de GHL cae a "la última"). La ficha del contacto abre siempre a la
// persona correcta.
// ===========================================================================

const GHL_APP_BASE = "https://app.gohighlevel.com/v2/location";

export async function GET(req: NextRequest) {
  const convId = req.nextUrl.searchParams.get("c");
  const locationId = process.env.NEXT_PUBLIC_GHL_LOCATION_ID ?? "";

  // Sin locationId no hay forma de armar una URL de GHL: caemos al visor interno.
  if (!locationId) {
    return NextResponse.redirect(
      new URL(convId ? `/conversations?id=${convId}` : "/wa", req.nextUrl.origin),
    );
  }

  const inboxUrl = `${GHL_APP_BASE}/${locationId}/conversations/conversations?category=team-inbox&tab=all`;
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

  // Ficha del contacto: abre a la persona correcta (el thread directo no es
  // confiable en GHL).
  return NextResponse.redirect(`${GHL_APP_BASE}/${locationId}/contacts/detail/${contactId}`);
}
