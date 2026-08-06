import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/counts
//
// Conteos de pendientes por módulo para los badges del header (estilo
// notificación). Liviano: solo `count`, sin traer filas. RLS aísla por cliente.
//
//  - payments: lo que hay para revisar en Aprobaciones = comprobantes en estado
//    'pending' + conversaciones con un título profesional a revisar (sin
//    comprobante que las agrupe). El módulo muestra las dos cosas, así que el
//    badge tiene que contar las dos o no coincide con lo que se ve en pantalla.
//  - interventions: derivaciones sin resolver, excluyendo las que tienen
//    módulo propio (`validacion_pago` → /payments, `reclamo_certificado` →
//    /certificados).
//  - certificados: reclamos de certificados (`reclamo_certificado`) sin resolver.
//  - agendar: contactos de WhatsApp todavía sin agendar (agendada = false).
// ===========================================================================

export interface ModuleCounts {
  payments: number;
  interventions: number;
  certificados: number;
  agendar: number;
}

export async function GET() {
  const sb = getSupabaseServerClient();

  const [payments, interventions, certificados, payConvRows, titleRows, heldRows] =
    await Promise.all([
    sb
      .from("payment_validations")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    sb
      .from("agent_notifications")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .not("category", "in", "(validacion_pago,reclamo_certificado)"),
    sb
      .from("agent_notifications")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("category", "reclamo_certificado"),
    // Conversaciones con comprobante (el módulo Agendar es solo para esas).
    sb.from("payment_validations").select("conversation_id").not("conversation_id", "is", null),
    // Títulos a revisar (la IA no los dio por válidos y nadie los revisó aún).
    sb
      .from("professional_titles")
      .select("conversation_id")
      .eq("is_valid", false)
      .is("reviewed_at", null)
      .not("conversation_id", "is", null),
    // Comprobantes retenidos esperando título: esas conversaciones ya muestran
    // el título dentro de su propia card, así que no se cuentan dos veces.
    sb
      .from("payment_validations")
      .select("conversation_id")
      .eq("awaiting_title", true)
      .not("conversation_id", "is", null),
  ]);

  // agendar: de las que mandaron comprobante, las que todavía no están agendadas.
  const comprobanteConvIds = Array.from(
    new Set((payConvRows.data ?? []).map((r) => r.conversation_id).filter(Boolean) as string[]),
  );
  let agendar = 0;
  if (comprobanteConvIds.length) {
    const { count } = await sb
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("source", "whatsapp")
      .eq("agendada", false)
      .in("id", comprobanteConvIds);
    agendar = count ?? 0;
  }

  // Conversaciones con título a revisar que NO tienen un comprobante retenido
  // (esas ya aparecen como card de comprobante). Misma lógica que usa
  // /api/payments para armar `titleReviews`.
  const held = new Set(
    (heldRows.data ?? []).map((r) => r.conversation_id).filter(Boolean) as string[],
  );
  const titleReviewConvs = new Set(
    (titleRows.data ?? [])
      .map((r) => r.conversation_id)
      .filter((id): id is string => Boolean(id) && !held.has(id as string)),
  );

  const counts: ModuleCounts = {
    payments: (payments.count ?? 0) + titleReviewConvs.size,
    interventions: interventions.count ?? 0,
    certificados: certificados.count ?? 0,
    agendar,
  };
  return NextResponse.json(counts);
}
