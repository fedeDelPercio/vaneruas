import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { ghlFetchRecentInbound, downloadUrl } from "@/lib/providers/ghl";
import { freshAttachmentCaptions, planInbound } from "@/lib/providers/ghl-inbound";
import { uploadComprobante, isAllowedComprobanteType } from "@/lib/payments/storage";
import { transcribeAudio, isAudioType } from "@/lib/audio/transcribe";

export const dynamic = "force-dynamic";
// El debounce mantiene viva la función durante la ventana de silencio (espera
// + buffer) antes de disparar el worker. Cubre hasta ~85s de ventana.
export const maxDuration = 90;

// ===========================================================================
// POST /api/webhooks/ghl/inbound
//
// Webhook entrante desde GoHighLevel (workflow "Customer Replied" sobre el
// canal WhatsApp en modo coexistence). GHL manda el contacto + el mensaje;
// acá lo traducimos a nuestro modelo: buscamos/creamos la conversación por el
// id de contacto de GHL (external_id), guardamos el mensaje del usuario y
// encolamos un job para que el agente lo procese.
//
// PASO 1 (este): la respuesta del agente queda en el panel. El envío de vuelta
// a WhatsApp (sender → API de GHL) es un paso aparte.
//
// Auth: en prod el dominio ya está detrás del bypass de Deployment Protection
// (solo quien tenga el secreto de bypass llega acá). Si además se setea
// GHL_WEBHOOK_SECRET, se exige el header x-ghl-secret como segunda capa.
// ===========================================================================

// El payload de GHL trae muchos campos; solo validamos los que usamos y
// dejamos pasar el resto. El cuerpo del mensaje puede venir en `message.body`
// (payload estándar) o en `customData.message` (si se mapeó en el workflow).
const ghlSchema = z
  .object({
    contact_id: z.string().min(1),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    full_name: z.string().nullish(),
    phone: z.string().nullish(),
    message: z.object({ body: z.string().nullish() }).nullish(),
    customData: z.object({ message: z.string().nullish() }).nullish(),
    location: z.object({ id: z.string().nullish() }).nullish(),
  })
  .passthrough();

function isAuthorized(req: NextRequest): boolean {
  const secret = serverEnv().GHL_WEBHOOK_SECRET;
  // Sin secreto configurado no exigimos header (el bypass de Vercel ya
  // protege el endpoint en prod, y en dev no hay protección).
  if (!secret) return true;
  return req.headers.get("x-ghl-secret") === secret;
}

function resolveDisplayName(d: z.infer<typeof ghlSchema>): string {
  if (d.full_name?.trim()) return d.full_name.trim();
  const composed = [d.first_name, d.last_name].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  if (d.phone?.trim()) return d.phone.trim();
  return "Contacto WhatsApp";
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ghlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload de GHL invalido", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Texto del mensaje: estándar primero, fallback al custom data.
  const webhookText = (data.message?.body ?? data.customData?.message ?? "").trim();
  const locationId = data.location?.id ?? "";

  const supabase = getSupabaseServerClient();

  // 1. Buscar / crear la conversación por el id de contacto de GHL. RLS la
  //    acota al cliente activo, así que external_id no colisiona entre clientes.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("external_id", data.contact_id)
    .eq("source", "whatsapp")
    .maybeSingle();

  let conversationId = existing?.id ?? null;
  if (!conversationId) {
    const { data: created, error: convErr } = await supabase
      .from("conversations")
      .insert({
        display_name: resolveDisplayName(data),
        source: "whatsapp",
        external_id: data.contact_id,
        wa_jid: data.phone ?? null,
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

  // 2. Resolver texto + adjuntos. El webhook NO trae las URLs de los adjuntos:
  //    las traemos de la API de GHL. Procesamos TODOS los adjuntos recientes que
  //    todavía no procesamos (varios comprobantes llegan como mensajes
  //    separados), deduplicando por URL de origen. Cada adjunto se guarda como
  //    su propio mensaje (con su caption) para que el worker lo valide aparte.
  interface InboundItem {
    content: string;
    attachmentPath: string | null;
    attachmentType: string | null;
    sourceUrl: string | null;
    isComprobante: boolean;
  }
  const items: InboundItem[] = [];

  if (locationId) {
    const recent = await ghlFetchRecentInbound(data.contact_id, locationId);
    const captions = freshAttachmentCaptions(recent, Date.now());
    const candidateUrls = [...captions.keys()];

    // Dedup: descartamos las URLs que ya procesamos en esta conversación.
    let processed = new Set<string>();
    if (candidateUrls.length) {
      const { data: ex } = await supabase
        .from("messages")
        .select("attachment_source_url")
        .eq("conversation_id", conversationId)
        .in("attachment_source_url", candidateUrls);
      processed = new Set(
        (ex ?? [])
          .map((r) => r.attachment_source_url)
          .filter((u): u is string => Boolean(u)),
      );
    }

    const plan = planInbound(captions, processed, webhookText);

    // Un item por adjunto nuevo, clasificado al vuelo.
    for (const att of plan.attachments) {
      const file = await downloadUrl(att.url);
      if (!file) continue;
      if (isAllowedComprobanteType(file.contentType)) {
        const path = await uploadComprobante({
          bytes: file.bytes,
          contentType: file.contentType,
          conversationId,
        });
        items.push({
          content: att.caption,
          attachmentPath: path,
          attachmentType: file.contentType,
          sourceUrl: att.url,
          isComprobante: true,
        });
      } else if (isAudioType(file.contentType)) {
        // Nota de voz: la transcribimos. Si falla, placeholder explícito (el
        // agente pide que lo escriban, no asume comprobante).
        const transcript = await transcribeAudio({
          bytes: file.bytes,
          contentType: file.contentType,
        });
        items.push({
          content:
            transcript || att.caption || "[Mensaje de audio que no se pudo transcribir]",
          attachmentPath: null,
          attachmentType: null,
          sourceUrl: att.url,
          isComprobante: false,
        });
      } else {
        items.push({
          content: att.caption || "[Archivo adjunto recibido]",
          attachmentPath: null,
          attachmentType: null,
          sourceUrl: att.url,
          isComprobante: false,
        });
      }
    }

    // Texto del webhook como mensaje aparte (si no es el caption de un adjunto).
    if (plan.textItem) {
      items.push({
        content: plan.textItem,
        attachmentPath: null,
        attachmentType: null,
        sourceUrl: null,
        isComprobante: false,
      });
    }
  } else if (webhookText) {
    // Sin locationId no podemos consultar GHL: solo el texto del webhook.
    items.push({
      content: webhookText,
      attachmentPath: null,
      attachmentType: null,
      sourceUrl: null,
      isComprobante: false,
    });
  }

  if (items.length === 0) {
    return NextResponse.json({ skipped: "sin contenido" }, { status: 200 });
  }

  // 3. Guardar cada item como mensaje + job. Comprobantes: job inmediato.
  //    Texto/audio: debounce (ventana de silencio, se consolidan en el worker).
  const debounceSeconds = serverEnv().MESSAGE_DEBOUNCE_SECONDS;
  let anyImmediate = false;
  const createdMessageIds: string[] = [];

  for (const item of items) {
    if (!item.content && !item.attachmentPath) continue;
    const { data: message, error: msgErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: item.content,
        attachment_path: item.attachmentPath,
        attachment_type: item.attachmentType,
        attachment_source_url: item.sourceUrl,
      })
      .select("id")
      .single();
    if (msgErr || !message) {
      return NextResponse.json(
        { error: msgErr?.message ?? "No se pudo guardar el mensaje" },
        { status: 500 },
      );
    }
    createdMessageIds.push(message.id);

    const isImmediate = item.isComprobante || debounceSeconds <= 0;
    if (isImmediate) anyImmediate = true;
    const processAfter = isImmediate
      ? new Date().toISOString()
      : new Date(Date.now() + debounceSeconds * 1000).toISOString();

    const { error: jobErr } = await supabase.from("agent_jobs").insert({
      conversation_id: conversationId,
      user_message_id: message.id,
      status: "pending",
      process_after: processAfter,
    });
    if (jobErr) {
      return NextResponse.json(
        { error: jobErr.message ?? "No se pudo encolar el job" },
        { status: 500 },
      );
    }
  }

  if (createdMessageIds.length === 0) {
    return NextResponse.json({ skipped: "sin contenido" }, { status: 200 });
  }

  // 4. Reordenar la conversación (más reciente primero en el panel).
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  // 5. Auto-trigger del worker. Lleva el header de bypass de Vercel si está.
  const workerHeaders: Record<string, string> = {
    "x-cron-secret": serverEnv().CRON_SECRET,
  };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    workerHeaders["x-vercel-protection-bypass"] =
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const triggerWorker = () =>
    fetch(`${req.nextUrl.origin}/api/jobs/process`, {
      method: "POST",
      headers: workerHeaders,
    }).catch(() => {
      // El cron lo levanta igual; no es crítico si este disparo falla.
    });

  // Inmediato si hubo comprobante (no se acumula); si todo fue texto/audio,
  // esperamos la ventana de debounce y recién ahí disparamos.
  if (anyImmediate || debounceSeconds <= 0) {
    after(triggerWorker());
  } else {
    after(
      (async () => {
        await new Promise((r) => setTimeout(r, (debounceSeconds + 2) * 1000));
        await triggerWorker();
      })(),
    );
  }

  return NextResponse.json(
    { conversationId, messages: createdMessageIds.length },
    { status: 200 },
  );
}
