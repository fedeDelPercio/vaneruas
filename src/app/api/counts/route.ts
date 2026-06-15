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
//  - interventions: derivaciones sin resolver, excluyendo `validacion_pago`
//    (esas viven en el módulo de aprobaciones, no en la bandeja).
// ===========================================================================

export interface ModuleCounts {
  payments: number;
  interventions: number;
}

export async function GET() {
  const sb = getSupabaseServerClient();

  const [payments, interventions] = await Promise.all([
    sb
      .from("payment_validations")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    sb
      .from("agent_notifications")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .not("category", "in", "(validacion_pago)"),
  ]);

  const counts: ModuleCounts = {
    payments: payments.count ?? 0,
    interventions: interventions.count ?? 0,
  };
  return NextResponse.json(counts);
}
