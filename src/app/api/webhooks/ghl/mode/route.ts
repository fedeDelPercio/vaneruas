import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// ===========================================================================
// POST /api/webhooks/ghl/mode
//
// Switch Humano/IA por tag desde GoHighLevel. Un workflow de GHL con trigger
// "Contact Tag" (agregado y quitado) pega acá; según el contacto tenga o no el
// tag de pausa, ponemos la conversación en modo HUMAN (IA callada) o AI.
//
// El worker ya respeta conversations.mode: si es HUMAN, el agente no responde.
// Por ahora solo el switch; la captura de lo que escribe el humano (trazabilidad)
// va en una etapa siguiente con la app de GHL.
// ===========================================================================

// Tag que marca "la atiende un humano, pausá la IA". Configurable por env.
const PAUSE_TAG = (process.env.GHL_PAUSE_TAG ?? "ia-pausada").trim().toLowerCase();

const schema = z
  .object({
    contact_id: z.string().min(1).optional(),
    contactId: z.string().min(1).optional(),
    // GHL puede mandar tags como CSV ("a,b,c") o como array.
    tags: z.union([z.string(), z.array(z.string())]).nullish(),
  })
  .passthrough();

function isAuthorized(req: NextRequest): boolean {
  const secret = serverEnv().GHL_WEBHOOK_SECRET;
  if (!secret) return true;
  return req.headers.get("x-ghl-secret") === secret;
}

function parseTags(tags: string | string[] | null | undefined): string[] {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(",");
  return arr.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const contactId = parsed.data.contact_id ?? parsed.data.contactId;
  if (!contactId) {
    return NextResponse.json({ error: "Falta contact_id" }, { status: 400 });
  }

  // Presencia del tag de pausa = la maneja un humano.
  const mode = parseTags(parsed.data.tags).includes(PAUSE_TAG) ? "HUMAN" : "AI";

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ mode })
    .eq("external_id", contactId)
    .eq("source", "whatsapp")
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // updated=0 cuando el contacto todavía no tiene conversación nuestra (nunca
  // escribió): no es error, el modo se aplicará cuando exista (default AI).
  return NextResponse.json({ contactId, mode, updated: data?.length ?? 0 }, { status: 200 });
}
