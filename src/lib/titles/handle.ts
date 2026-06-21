import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { downloadComprobante } from "@/lib/payments/storage";
import {
  handlePaymentComprobante,
  releaseAwaitingComprobantes,
} from "@/lib/payments/register";
import { classifyAttachment, type AttachmentClassification } from "./classify";
import { deliverAssistantToWhatsApp } from "@/lib/whatsapp-delivery";
import { ghlFetchContact, ghlContactIsRegistered } from "@/lib/providers/ghl";

// ===========================================================================
// Gate de validación de título profesional.
//
// Cuando llega un adjunto en una conversación, decidimos qué hacer según si la
// contacta está registrada y si ya acreditó su título:
//
//  - Registrada (is_existing_customer) o con título ya validado → flujo normal
//    de comprobante (sin cambios).
//  - No registrada y sin título → clasificamos la imagen:
//      · comprobante → se registra RETENIDO (awaiting_title) y le pedimos el
//        título; no se avisa al equipo todavía.
//      · título → una IA lo valida; si es genuino, se guarda, se tilda
//        "clienta" (is_existing_customer=true) y se LIBERA el comprobante
//        retenido (recién ahí se avisa al equipo). Si no, le pedimos uno válido.
//      · otro → le pedimos que mande el comprobante o el título.
//
// El check de "registrada" hoy usa conversations.is_existing_customer; a futuro
// será la integración con GHL.
// ===========================================================================

interface IntakeArgs {
  conversationId: string;
  messageId: string;
  attachmentPath: string;
  attachmentType: string;
  caption?: string | null;
}

// Devuelve `handled`: true si el flujo de comprobante/título resolvió el
// mensaje; false si NO es un tema de pago (imagen "otro" con texto que indica
// otra intención) y debe seguir por el agente normal (que se presenta y deriva).
export async function handleAttachmentIntake(
  args: IntakeArgs,
): Promise<{ handled: boolean }> {
  const supabase = getSupabaseServerClient();

  // ¿Registrada como contacto? Primero el flag local (ATP); si no, consultamos
  // GHL: una clienta ya agendada (con email, o nombre y apellido) no tiene que
  // acreditar el título de nuevo. Ver `ghlContactIsRegistered`.
  const { data: conv } = await supabase
    .from("conversations")
    .select("is_existing_customer, source, external_id")
    .eq("id", args.conversationId)
    .maybeSingle();
  let registered = conv?.is_existing_customer ?? false;

  if (!registered && conv?.source === "whatsapp" && conv.external_id) {
    const ghlContact = await ghlFetchContact(conv.external_id);
    if (ghlContactIsRegistered(ghlContact)) {
      registered = true;
      // Cacheamos el alta y, si GHL tiene el email, lo guardamos (así después
      // no se lo pedimos al aprobar el pago).
      await supabase
        .from("conversations")
        .update({
          is_existing_customer: true,
          ...(ghlContact?.email ? { contact_email: ghlContact.email } : {}),
        })
        .eq("id", args.conversationId);
    }
  }

  // ¿Ya acreditó un título válido en esta conversación?
  let hasValidTitle = false;
  if (!registered) {
    const { data: titles } = await supabase
      .from("professional_titles")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("is_valid", true)
      .limit(1);
    hasValidTitle = Boolean(titles?.length);
  }

  // Clasificar SIEMPRE el adjunto con vision antes de tratarlo como pago.
  // Necesitamos saber si la imagen es un comprobante, un título u otra cosa:
  // sin este check, un título mandado por una clienta registrada se registraba
  // como "comprobante de pago" (bug real: alguien manda el diploma y la IA lo
  // toma como comprobante). El extractor de comprobantes corre después; acá
  // solo decidimos el enrutamiento.
  let cls: AttachmentClassification | null = null;
  try {
    const bytes = await downloadComprobante(args.attachmentPath);
    cls = await classifyAttachment({ bytes, contentType: args.attachmentType });
  } catch (err) {
    console.error("[titles] no se pudo clasificar el adjunto:", err);
  }

  // Fallback si la clasificación falla: si la contacta ya está habilitada
  // (registrada o con título), lo tratamos como comprobante normal; si no,
  // como comprobante retenido (seguro: no aprobamos nada sin título).
  const kind = cls?.kind ?? "comprobante";

  // Título / certificado: lo enruta el flujo de título (lo valida y registra).
  // Para no registradas funciona además como gate; para registradas solo lo
  // reconoce y responde, sin confundirlo con un comprobante.
  if (kind === "titulo") {
    await handleTitleSubmission(args, cls);
    return { handled: true };
  }

  // Comprobante de pago: camino de pago. Retenido solo si todavía falta
  // acreditar el título (no registrada y sin título válido).
  if (kind === "comprobante") {
    if (registered || hasValidTitle) {
      await handlePaymentComprobante(args);
    } else {
      await handlePaymentComprobante(args, { awaitingTitle: true });
    }
    return { handled: true };
  }

  // "otro": la imagen no es comprobante ni título.
  const caption = (args.caption ?? "").trim();
  const hasMeaningfulText = caption.length > 0 && !caption.startsWith("[");
  if (hasMeaningfulText) {
    // El texto indica otra intención (ej. "perdí mis archivos, mándenme los
    // PDFs", una gestión administrativa, un caso raro). No es un tema de pago:
    // que lo maneje el agente normal, que se presenta si la conversación es
    // nueva y deriva a una persona si corresponde.
    return { handled: false };
  }

  // Sin texto que aclare: imagen suelta no reconocida. Puede ser un título
  // borroso, así que la dejamos registrada para que el equipo la mire y le
  // pedimos que aclare qué necesita.
  await supabase.from("professional_titles").insert({
    conversation_id: args.conversationId,
    message_id: args.messageId,
    file_path: args.attachmentPath,
    file_type: args.attachmentType,
    holder_name: cls?.holder_name ?? null,
    title_name: cls?.title_name ?? null,
    institution: cls?.institution ?? null,
    confidence: cls?.confidence ?? null,
    extraction: (cls as unknown as Json) ?? null,
    is_valid: false,
    validation_note:
      cls?.note ?? "La IA no reconoció la imagen como título, revisar a mano",
  });
  await insertAssistant(
    args.conversationId,
    "No pude reconocer esa imagen, me mandás el comprobante de pago o tu título o certificado de alumno del rubro según lo que necesites resolver?",
  );
  await touchConversation(args.conversationId);
  return { handled: true };
}

async function handleTitleSubmission(
  args: IntakeArgs,
  cls: AttachmentClassification | null,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const valid = cls?.title_is_valid ?? false;

  // Guardar el título recibido (válido o no, para auditoría).
  await supabase.from("professional_titles").insert({
    conversation_id: args.conversationId,
    message_id: args.messageId,
    file_path: args.attachmentPath,
    file_type: args.attachmentType,
    holder_name: cls?.holder_name ?? null,
    title_name: cls?.title_name ?? null,
    institution: cls?.institution ?? null,
    confidence: cls?.confidence ?? null,
    extraction: (cls as unknown as Json) ?? null,
    is_valid: valid,
    validation_note: cls?.note ?? null,
  });

  if (!valid) {
    await insertAssistant(
      args.conversationId,
      "Mmm, no pude validar ese archivo, me lo reenviás bien claro y completo? Tiene que verse tu título o certificado de alumno en curso del rubro, con tu nombre 🙏🏼",
    );
    await touchConversation(args.conversationId);
    return;
  }

  // Título válido: tildar "clienta", liberar el comprobante retenido y avisarle.
  await markConversationTitleValidated(args.conversationId, {
    systemNote: "Título profesional validado por IA, contacta marcada como clienta",
  });
}

/**
 * Marca una conversación como "título acreditado": tilda `is_existing_customer`
 * (a futuro, GHL), libera los comprobantes retenidos (recién ahí se avisa al
 * equipo) y le confirma a la profesional. Lo usan tanto la validación
 * automática por IA como la validación manual desde el panel.
 */
export async function markConversationTitleValidated(
  conversationId: string,
  opts: { systemNote: string },
): Promise<number> {
  const supabase = getSupabaseServerClient();

  await supabase
    .from("conversations")
    .update({ is_existing_customer: true, updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  const released = await releaseAwaitingComprobantes(conversationId);

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "system",
    content: opts.systemNote,
  });

  // ¿Ya tenemos un comprobante de esta conversación? Puede venir por dos vías:
  //  - retenido y recién liberado por la validación del título (released > 0),
  //  - o procesado aparte (camino normal) cuando manda título + comprobante
  //    JUNTOS y el título se valida primero (su llamada de vision es más rápida).
  // En cualquiera de los dos casos NO le pedimos el comprobante (ya lo tenemos).
  // Si todavía no hay ninguno, el mensaje queda flexible: no asumimos si ya pagó.
  let hasComprobante = released > 0;
  if (!hasComprobante) {
    const { data: pv } = await supabase
      .from("payment_validations")
      .select("id")
      .eq("conversation_id", conversationId)
      .limit(1);
    hasComprobante = Boolean(pv?.length);
  }

  await insertAssistant(
    conversationId,
    hasComprobante
      ? "Listo, validé tu título ✨ Ya tengo tu comprobante, el equipo revisa la inscripción y te confirma a la brevedad 🙌"
      : "Listo, validé tu título ✨ Si ya hiciste el pago, con el comprobante confirmamos tu inscripción 🙌",
  );
  await touchConversation(conversationId);
  return released;
}

async function insertAssistant(conversationId: string, content: string): Promise<void> {
  const { data } = await getSupabaseServerClient()
    .from("messages")
    .insert({ conversation_id: conversationId, role: "assistant", content })
    .select("id")
    .single();
  // Entrega real al WhatsApp del contacto (vía GHL) si corresponde.
  await deliverAssistantToWhatsApp({ conversationId, messageId: data?.id, content });
}

async function touchConversation(conversationId: string): Promise<void> {
  await getSupabaseServerClient()
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}
