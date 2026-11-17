import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listNotifications, type NotificationListItem } from "@/lib/notifications-list";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/interventions?status=pending|resolved|all&q=
//
// Bandeja de derivaciones al equipo: las notificaciones del agente que
// implican intervención humana, excluyendo las derivadas por comprobante
// (`validacion_pago`), que se trabajan en /payments (ver EXCLUDED_CATEGORIES).
//
// Resuelve la conversación de origen y quién marcó la derivación como
// atendida. RLS aísla por client_slug vía el JWT.
// ===========================================================================


// Categorías que NO entran a la bandeja porque tienen su propio módulo:
//  - `validacion_pago` → /payments (comprobantes; el worker los procesa fuera
//    del orquestador y solo registra esa notificación).
//  - `reclamo_certificado` → /certificados (reclamos de certificados de
//    masterclass; misma idea: bandeja propia, ver src/app/api/certificados).
// El resto de las categorías (cliente_existente, interes_compra,
// fuera_de_conocimiento, escalado_manual, falla_tecnica) SÍ necesitan la
// atención del equipo acá (esta clienta va a tener muchas clientas existentes,
// y queremos verlas).
const EXCLUDED_CATEGORIES = ["validacion_pago", "reclamo_certificado"];

export type InterventionItem = NotificationListItem;

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  try {
    const result = await listNotifications({
      sb: getSupabaseServerClient(),
      status,
      q,
      excludeCategories: EXCLUDED_CATEGORIES,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudieron cargar las derivaciones" },
      { status: 500 },
    );
  }
}
