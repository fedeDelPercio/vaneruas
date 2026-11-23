import "server-only";

import { fixedTextVariants } from "@/lib/whatsapp-templates";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// ===========================================================================
// Dedup de mensajes del asistente.
//
// Cuando una persona manda VARIOS adjuntos juntos (varios certificados, varios
// comprobantes), cada uno entra como un mensaje/job aparte y se procesa por
// separado. Sin esto, cada uno dispararía la misma confirmación y el contacto
// recibiría el mismo texto repetido N veces. Antes de mandar un mensaje de los
// flujos automáticos (comprobante, título), chequeamos si YA mandamos uno
// idéntico hace poco; si sí, lo salteamos.
//
// El worker procesa los jobs en serie dentro de una invocación, así que el
// chequeo es confiable para un burst que entra junto. (Ventana corta para no
// suprimir una repetición legítima mucho más tarde en la conversación.)
// ===========================================================================

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

/**
 * ¿Ya mandamos un mensaje de asistente con este MISMO contenido en esta
 * conversación dentro de la ventana reciente? Best-effort: ante error devuelve
 * false (mejor mandar de más que tragarse un mensaje por un fallo de lectura).
 */
export async function assistantSaidRecently(
  conversationId: string,
  content: string,
  withinMs: number = DEFAULT_WINDOW_MS,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinMs).toISOString();
    const variants = fixedTextVariants(content);
    const query = getSupabaseServerClient()
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .gte("created_at", since)
      .limit(1);
    const { data } = await (variants.length > 1 ? query.in("content", variants) : query.eq("content", content));
    return Boolean(data?.length);
  } catch {
    return false;
  }
}
