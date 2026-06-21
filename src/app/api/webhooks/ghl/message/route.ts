import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// ===========================================================================
// POST /api/webhooks/ghl/message
//
// Webhook UNIFICADO de la app de GoHighLevel. Suscripto a InboundMessage +
// OutboundMessage, recibe TODOS los mensajes de las conversaciones (a
// diferencia del workflow "Customer Replied", que solo manda texto y sin
// adjuntos). Reemplaza a /api/webhooks/ghl/inbound una vez instalada la app.
//
//  - InboundMessage  -> mensaje del contacto (texto + adjuntos). Se guarda como
//    role="user" y se encola el job para que la IA responda (respetando mode).
//  - OutboundMessage -> mensaje saliente. Si es NUESTRO (lo envió la IA por la
//    API, matchea external_id), se ignora. Si lo escribió un HUMANO desde GHL,
//    se guarda como role="human" (trazabilidad). NO cambia el modo (eso lo hace
//    el tag) ni encola job.
//
// Auth: la URL que se carga en la app lleva el bypass de Deployment Protection
// como query param (?x-vercel-protection-bypass=...), que es el gate de borde.
// La verificación de firma Ed25519/RSA de GHL queda como mejora (env
// GHL_WEBHOOK_PUBLIC_KEY) una vez que tengamos la clave pública.
// ===========================================================================

// El payload de GHL trae muchos campos; validamos laxo y dejamos pasar el resto.
const ghlMsgSchema = z
  .object({
    type: z.string().nullish(), // "InboundMessage" | "OutboundMessage"
    locationId: z.string().nullish(),
    contactId: z.string().nullish(),
    conversationId: z.string().nullish(),
    messageId: z.string().nullish(),
    body: z.string().nullish(),
    direction: z.string().nullish(), // "inbound" | "outbound"
    messageType: z.string().nullish(),
    userId: z.string().nullish(),
    source: z.string().nullish(),
    from: z.string().nullish(),
    // attachments: array de URLs (strings) o de objetos { url }.
    attachments: z
      .array(z.union([z.string(), z.object({ url: z.string().nullish() }).passthrough()]))
      .nullish(),
  })
  .passthrough();

type GhlMsg = z.infer<typeof ghlMsgSchema>;

function isAuthorized(req: NextRequest): boolean {
  // Secreto compartido opcional (query ?s=... o header), además del bypass de
  // borde. Si no está configurado, no se exige.
  const secret = serverEnv().GHL_WEBHOOK_SECRET;
  if (!secret) return true;
  return (
    req.nextUrl.searchParams.get("s") === secret ||
    req.headers.get("x-ghl-secret") === secret
  );
}

/** Normaliza attachments a un array de URLs. */
function attachmentUrls(att: GhlMsg["attachments"]): string[] {
  if (!att) return [];
  return att
    .map((a) => (typeof a === "string" ? a : a?.url ?? ""))
    .map((u) => u.trim())
    .filter(Boolean);
}

/** ¿El evento es entrante? Prioriza `type`, cae a `direction`. */
function isInbound(d: GhlMsg): boolean {
  if (d.type) return d.type.toLowerCase().includes("inbound");
  return (d.direction ?? "").toLowerCase() === "inbound";
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ghlMsgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalido", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const contactId = d.contactId;
  const messageId = d.messageId;
  if (!contactId) {
    return NextResponse.json({ skipped: "sin contactId" }, { status: 200 });
  }

  const urls = attachmentUrls(d.attachments);
  const text = (d.body ?? "").trim();
  if (!text && urls.length === 0) {
    // Evento sin contenido útil (ej. update de estado). No es error.
    return NextResponse.json({ skipped: "sin contenido" }, { status: 200 });
  }

  const supabase = getSupabaseServerClient();

  // Dedup por messageId: si ya tenemos un mensaje con ese external_id, no lo
  // re-procesamos (cubre reenvíos del webhook Y nuestros propios envíos salientes,
  // cuyo messageId guardamos al enviar por la API de GHL).
  if (messageId) {
    const { data: dup } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", messageId)
      .maybeSingle();
    if (dup) {
      return NextResponse.json({ skipped: "duplicado (ya procesado)", messageId }, { status: 200 });
    }
  }

  // Contenido legible: el texto + marcadores de adjuntos con su URL.
  const content =
    [text, ...urls.map((u) => `[Adjunto: ${u}]`)].filter(Boolean).join("\n").trim() ||
    "[Adjunto]";

  if (isInbound(d)) {
    // ----- Mensaje del contacto -----
    // Buscar o crear la conversación por el id de contacto de GHL.
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("external_id", contactId)
      .eq("source", "whatsapp")
      .maybeSingle();

    let conversationId = existing?.id ?? null;
    if (!conversationId) {
      const { data: created, error: convErr } = await supabase
        .from("conversations")
        .insert({
          display_name: d.from?.trim() || "Contacto WhatsApp",
          source: "whatsapp",
          external_id: contactId,
          wa_jid: d.from ?? null,
        })
        .select("id")
        .single();
      if (convErr || !created) {
        return NextResponse.json(
          { error: convErr?.message ?? "No se pudo crear la conversacion" },
          { status: 500 },
        );
      }
      conversationId = created.id;
    }

    const { data: message, error: msgErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content,
        external_id: messageId ?? null,
      })
      .select("id")
      .single();
    if (msgErr || !message) {
      return NextResponse.json(
        { error: msgErr?.message ?? "No se pudo guardar el mensaje" },
        { status: 500 },
      );
    }

    const { data: job } = await supabase
      .from("agent_jobs")
      .insert({ conversation_id: conversationId, user_message_id: message.id, status: "pending" })
      .select("id")
      .single();

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    // Disparar el worker (mismo patrón que los otros webhooks).
    const workerHeaders: Record<string, string> = { "x-cron-secret": serverEnv().CRON_SECRET };
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      workerHeaders["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    after(
      fetch(`${req.nextUrl.origin}/api/jobs/process`, { method: "POST", headers: workerHeaders }).catch(
        () => {},
      ),
    );

    return NextResponse.json(
      { kind: "inbound", conversationId, messageId: message.id, jobId: job?.id ?? null, attachments: urls.length },
      { status: 200 },
    );
  }

  // ----- Mensaje saliente que NO es nuestro -> lo escribió un humano -----
  // (Si fuera nuestro, habría matcheado el dedup por messageId más arriba.)
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("external_id", contactId)
    .eq("source", "whatsapp")
    .maybeSingle();

  if (!conv) {
    // Saliente de un contacto que aún no tiene conversación nuestra: lo
    // ignoramos (no hay contexto al que adjuntarlo).
    return NextResponse.json({ skipped: "outbound sin conversacion" }, { status: 200 });
  }

  await supabase.from("messages").insert({
    conversation_id: conv.id,
    role: "human",
    content,
    external_id: messageId ?? null,
  });
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conv.id);

  // Log para afinar el dedup con payloads reales (source/userId del humano).
  console.debug(
    `[ghl/message] outbound humano guardado conv=${conv.id} source=${d.source} userId=${d.userId}`,
  );

  return NextResponse.json({ kind: "human", conversationId: conv.id }, { status: 200 });
}
