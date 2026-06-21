import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { ghlFetchLatestInbound, downloadUrl } from "@/lib/providers/ghl";
import { uploadComprobante, isAllowedComprobanteType } from "@/lib/payments/storage";

export const dynamic = "force-dynamic";

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

  // 2. Resolver contenido + adjunto. El webhook del workflow NO trae la URL del
  //    adjunto, así que cuando el mensaje llega sin texto (imagen/PDF/audio),
  //    consultamos la API de GHL (PIT) para recuperar la URL, la bajamos y, si
  //    es un comprobante (imagen/PDF), la subimos a storage para que el worker
  //    corra el flujo de validación de pago (handleAttachmentIntake).
  let content = webhookText;
  let attachmentPath: string | null = null;
  let attachmentType: string | null = null;

  if (!webhookText && locationId) {
    const latest = await ghlFetchLatestInbound(data.contact_id, locationId);
    const url = latest?.attachments[0];
    if (url) {
      const file = await downloadUrl(url);
      if (file && isAllowedComprobanteType(file.contentType)) {
        attachmentPath = await uploadComprobante({
          bytes: file.bytes,
          contentType: file.contentType,
          conversationId,
        });
        attachmentType = file.contentType;
        content = (latest?.body ?? "").trim();
      } else {
        // Otro tipo (ej. audio): lo dejamos visible. La transcripción de audios
        // es una mejora siguiente.
        content = (latest?.body ?? "").trim() || "[Archivo adjunto recibido]";
      }
    }
  }

  if (!content && !attachmentPath) {
    return NextResponse.json({ skipped: "sin contenido" }, { status: 200 });
  }

  // 3. Guardar el mensaje del usuario (con adjunto si es comprobante).
  const { data: message, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      content,
      attachment_path: attachmentPath,
      attachment_type: attachmentType,
    })
    .select("id")
    .single();
  if (msgErr || !message) {
    return NextResponse.json(
      { error: msgErr?.message ?? "No se pudo guardar el mensaje" },
      { status: 500 },
    );
  }

  // 4. Encolar el job para que el worker corra el agente.
  const { data: job, error: jobErr } = await supabase
    .from("agent_jobs")
    .insert({
      conversation_id: conversationId,
      user_message_id: message.id,
      status: "pending",
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    return NextResponse.json(
      { error: jobErr?.message ?? "No se pudo encolar el job" },
      { status: 500 },
    );
  }

  // 5. Reordenar la conversación (más reciente primero en el panel).
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  // 6. Auto-trigger del worker (mismo patrón que el webhook del panel). En
  //    Vercel el dominio asignado está protegido: este fetch interno lleva el
  //    header de bypass cuando "Protection Bypass for Automation" está activo.
  const workerHeaders: Record<string, string> = {
    "x-cron-secret": serverEnv().CRON_SECRET,
  };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    workerHeaders["x-vercel-protection-bypass"] =
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  after(
    fetch(`${req.nextUrl.origin}/api/jobs/process`, {
      method: "POST",
      headers: workerHeaders,
    }).catch(() => {
      // El cron lo levanta igual; no es crítico si este disparo falla.
    }),
  );

  return NextResponse.json(
    { conversationId, messageId: message.id, jobId: job.id },
    { status: 200 },
  );
}
