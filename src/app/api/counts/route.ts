import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/counts
//
// Conteos de pendientes por módulo para los badges del header (estilo
// notificación). Liviano: solo `count`, sin traer filas. RLS aísla por cliente.
//
//  - payments: comprobantes en estado 'pending' (a validar / aprobar).
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

  const [payments, interventions, certificados, payConvRows] = await Promise.all([
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

  const counts: ModuleCounts = {
    payments: payments.count ?? 0,
    interventions: interventions.count ?? 0,
    certificados: certificados.count ?? 0,
    agendar,
  };
  return NextResponse.json(counts);
}
