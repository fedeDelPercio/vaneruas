import { withoutStaleEnrollmentNotifications } from "@/lib/tiendup/pending-notifications";
import { NextResponse } from "next/server";
import { groupPendingPayments } from "@/lib/payments/grouping";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/counts
//
// Conteos de pendientes por módulo para los badges del header (estilo
// notificación). Liviano: casi todo `count`; los comprobantes pendientes se
// traen (pocas filas) para contarlos por grupo. RLS aísla por cliente.
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
    // Pendientes por GRUPO: varias imágenes del mismo pago son un comprobante
    // (src/lib/payments/grouping.ts).
    fetchAllRows((from, to) =>
      sb
        .from("payment_validations")
        .select("id, conversation_id, event_slug, status, amount, operation_number, created_at")
        .eq("status", "pending")
        .order("id", { ascending: true })
        .range(from, to),
    ).catch(() => []),
    fetchAllRows((from, to) => sb.from("agent_notifications")
      .select("id, reason, resolved_at")
      .is("resolved_at", null)
      .not("category", "in", "(validacion_pago,reclamo_certificado)")
      .order("id")
      .range(from, to))
      .then((rows) => withoutStaleEnrollmentNotifications(sb, rows))
      .catch(() => []),
    sb
      .from("agent_notifications")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("category", "reclamo_certificado"),
    // Conversaciones con comprobante (el módulo Agendar es solo para esas).
    // Paginado: son más de 1000 filas y sin esto se contaba sobre una parte.
    fetchAllRows((from, to) =>
      sb
        .from("payment_validations")
        .select("id, conversation_id")
        .not("conversation_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ).catch(() => [] as { id: string; conversation_id: string | null }[]),
    // Títulos a revisar (la IA no los dio por válidos y nadie los revisó aún).
    sb
      .from("professional_titles")
      .select("conversation_id")
      .eq("is_valid", false)
      .is("reviewed_at", null)
      .not("conversation_id", "is", null),
    // Conversaciones con un comprobante pendiente (retenido por título o no):
    // ya muestran el título dentro de su propia card, así que no se cuentan
    // dos veces. Mismo criterio que /api/payments.
    sb
      .from("payment_validations")
      .select("conversation_id")
      .eq("status", "pending")
      .not("conversation_id", "is", null),
  ]);

  // agendar: de las que mandaron comprobante, las que todavía no están agendadas.
  // Se cruza en memoria: pasar cientos de ids en un `.in()` desborda la URL,
  // el pedido falla y el badge quedaba en 0 (además de tardar ~9 segundos).
  const withComprobante = new Set(
    payConvRows.map((r) => r.conversation_id).filter(Boolean) as string[],
  );
  let agendar = 0;
  if (withComprobante.size) {
    const sinAgendar = await fetchAllRows((from, to) =>
      sb
        .from("conversations")
        .select("id")
        .eq("source", "whatsapp")
        .eq("agendada", false)
        .order("id", { ascending: true })
        .range(from, to),
    ).catch(() => [] as { id: string }[]);
    agendar = sinAgendar.filter((c) => withComprobante.has(c.id)).length;
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
    payments: groupPendingPayments(payments).length + titleReviewConvs.size,
    interventions: interventions.length,
    certificados: certificados.count ?? 0,
    agendar,
  };
  return NextResponse.json(counts);
}
