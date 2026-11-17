import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listNotifications, type NotificationListItem } from "@/lib/notifications-list";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/certificados?status=pending|resolved|all
//
// Reclamos de certificados/diplomas de masterclass: notificaciones del agente
// con categoría `reclamo_certificado` (asistentes que dicen no haber recibido
// su certificado). Es la contraparte de /api/interventions, pero filtrando
// SOLO esa categoría: tiene su propio módulo /certificados, igual que los
// comprobantes (`validacion_pago`) tienen el de /payments.
//
// Resuelve la conversación de origen y quién marcó el reclamo como atendido.
// RLS aísla por client_slug vía el JWT.
// ===========================================================================


const CERTIFICADO_CATEGORY = "reclamo_certificado";

export type CertificadoItem = Omit<NotificationListItem, "category">;

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  try {
    const result = await listNotifications({
      sb: getSupabaseServerClient(),
      status,
      q,
      onlyCategory: CERTIFICADO_CATEGORY,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudieron cargar los reclamos" },
      { status: 500 },
    );
  }
}
