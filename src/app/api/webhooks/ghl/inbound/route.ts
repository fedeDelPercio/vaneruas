import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

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
  const content = (data.message?.body ?? data.customData?.message ?? "").trim();
  if (!content) {
    // Sin texto no hay nada que procese el agente. Nota: el webhook del
    // workflow "Customer Replied" NO trae la URL de los adjuntos (imagen/PDF/
    // audio llegan con body vacío y attachments vacío). Los adjuntos se van a
    // manejar con el webhook InboundMessage de la app de GHL.
    return NextResponse.json({ skipped: "sin contenido de texto" }, { status: 200 });
  }

  const supabase = getSupabaseServerClient();

  // 1. Buscar la conversación existente por el id de contacto de GHL. RLS la
  //    acota al cliente activo, así que external_id no colisiona entre clientes.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("external_id", data.contact_id)
    .eq("source", "whatsapp")
    .maybeSingle();

  let conversationId = existing?.id ?? null;

  // 2. Si no existe, crearla. El client_slug lo pone el JWT scoped (RLS).
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

  // 3. Guardar el mensaje del usuario.
  const { data: message, error: msgErr } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content })
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
