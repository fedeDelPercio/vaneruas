import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { importarMensajesDelEquipo } from "@/lib/providers/ghl-human";

export const dynamic = "force-dynamic";

// ===========================================================================
// POST|GET /api/jobs/import-human
//
// Trae de GoHighLevel los mensajes que escribió el EQUIPO y los guarda como
// role="human". Lo dispara el cron de Vercel cada 5 minutos.
//
// Sin esto el panel no ve nada de lo que contesta una persona desde GHL: no
// está instalada la app con el webhook OutboundMessage, así que el evento nunca
// llega. Ver src/lib/providers/ghl-human.ts para el detalle.
//
// Protegido por CRON_SECRET (en dev se permite sin secret para probarlo a mano).
// Parámetros opcionales: ?horas=N (cuánto hacia atrás mirar) y ?max=N (tope de
// conversaciones por corrida).
// ===========================================================================

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = serverEnv().CRON_SECRET;
  return (
    req.headers.get("x-cron-secret") === secret ||
    req.headers.get("authorization") === `Bearer ${secret}`
  );
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const horas = Number(req.nextUrl.searchParams.get("horas") ?? "");
  const max = Number(req.nextUrl.searchParams.get("max") ?? "");
  const result = await importarMensajesDelEquipo(getSupabaseServerClient(), {
    sinceMs: Number.isFinite(horas) && horas > 0 ? Date.now() - horas * 3_600_000 : undefined,
    maxConversaciones: Number.isFinite(max) && max > 0 ? max : 300,
  });
  return NextResponse.json(result, { status: result.error ? 500 : 200 });
}

export const POST = run;
export const GET = run;
