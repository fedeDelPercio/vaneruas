import { NextRequest, NextResponse } from "next/server";
import { getComprobanteSignedUrl } from "@/lib/payments/storage";
import { clientEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/comprobantes/signed-url?path=<path>
//
// Devuelve una signed URL de vida corta para mostrar un comprobante guardado
// en el bucket privado. Lo usan las burbujas del panel (imagen adjunta) y, más
// adelante, el tab de validación de pagos. Se valida que el path pertenezca al
// cliente activo (namespaceado por client_slug) para no servir comprobantes
// de otro tenant.
// ===========================================================================

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Falta el path" }, { status: 400 });
  }

  const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;
  if (!path.startsWith(`${slug}/`)) {
    return NextResponse.json({ error: "Path no autorizado" }, { status: 403 });
  }

  const url = await getComprobanteSignedUrl(path);
  if (!url) {
    return NextResponse.json({ error: "No se pudo generar la URL" }, { status: 404 });
  }
  return NextResponse.json({ url }, { status: 200 });
}
