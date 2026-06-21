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
// ===========================================================================

export interface ModuleCounts {
  payments: number;
  interventions: number;
  certificados: number;
}

export async function GET() {
  const sb = getSupabaseServerClient();

  const [payments, interventions, certificados] = await Promise.all([
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
  ]);

  const counts: ModuleCounts = {
    payments: payments.count ?? 0,
    interventions: interventions.count ?? 0,
    certificados: certificados.count ?? 0,
  };
  return NextResponse.json(counts);
}
