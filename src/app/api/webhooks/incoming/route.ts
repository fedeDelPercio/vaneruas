import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { dispatchEvent } from "@/lib/webhooks/dispatcher";

export const dynamic = "force-dynamic";

// ===========================================================================
// POST /api/webhooks/incoming
//
// Webhook entrante. El panel le pega aca cuando el usuario manda un mensaje;
// en fase 2 le pegara Meta con el mismo contrato. NO corre el agente: encola
// un job y devuelve 200 OK al toque. El worker (/api/jobs/process) lo procesa.
// ===========================================================================

const incomingSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(8000),
  source: z.enum(["panel", "whatsapp"]).default("panel"),
  externalId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = incomingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { conversationId, content } = parsed.data;
  const supabase = getSupabaseServerClient();

  // 1. Persistir el mensaje del usuario.
  const { data: message, error: msgErr } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content })
    .select("id")
    .single();

  if (msgErr || !message) {
    // 23503 = violacion de FK: la conversacion no existe.
    if (msgErr?.code === "23503") {
      return NextResponse.json({ error: "Conversacion inexistente" }, { status: 404 });
    }
    return NextResponse.json(
      { error: msgErr?.message ?? "No se pudo guardar el mensaje" },
      { status: 500 },
    );
  }

  // 2. Encolar el job para que el worker corra el agente.
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

  // 3. Bump de updated_at para reordenar la lista de conversaciones.
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  // 4. Notificar el evento a los webhooks salientes suscriptos.
  await dispatchEvent("message.received", {
    conversationId,
    messageId: message.id,
    content,
  });

  // 5. Auto-trigger del worker. Usamos `after()` de Next: la respuesta sale
  //    enseguida (paso 6) pero Vercel mantiene viva la funcion hasta que el
  //    fetch al worker se complete. Sin `after`, la instancia serverless
  //    moria antes de que el fetch outbound llegara, dejando jobs en pending
  //    hasta el proximo cron (diario por plan Hobby).
  after(
    fetch(`${req.nextUrl.origin}/api/jobs/process`, {
      method: "POST",
      headers: { "x-cron-secret": serverEnv().CRON_SECRET },
    }).catch(() => {
      // El cron lo levanta igual; no es critico si este disparo falla.
    }),
  );

  // 6. 200 OK inmediato.
  return NextResponse.json({ messageId: message.id, jobId: job.id }, { status: 200 });
}
