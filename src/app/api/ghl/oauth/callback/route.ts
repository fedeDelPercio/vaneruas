import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/ghl/oauth/callback
//
// Redirect del flujo OAuth de GoHighLevel cuando se INSTALA la app en la
// subcuenta. GHL manda ?code=... (o ?error=...). La autorización ya quedó
// registrada en GHL del lado del usuario; para recibir los webhooks no
// necesitamos el access token (las llamadas a la API las hacemos con el PIT).
// Así que acá solo confirmamos la instalación con una página de OK.
//
// (A futuro, si hace falta el token OAuth —ej. bajar adjuntos con auth— se
// intercambia el code contra https://services.leadconnectorhq.com/oauth/token
// usando GHL_CLIENT_ID / GHL_CLIENT_SECRET.)
// ===========================================================================

function page(title: string, message: string, ok: boolean): NextResponse {
  const color = ok ? "#16a34a" : "#dc2626";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; background:#0a0a0a; color:#fafafa; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0;">
<div style="text-align:center; max-width:420px; padding:32px;">
<div style="font-size:40px; color:${color}; margin-bottom:12px;">${ok ? "&#10003;" : "&#10007;"}</div>
<h1 style="font-size:18px; font-weight:600; margin:0 0 8px;">${title}</h1>
<p style="font-size:13px; color:#a3a3a3; line-height:1.5; margin:0;">${message}</p>
</div></body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    return page(
      "No se pudo instalar",
      `GoHighLevel devolvió un error: ${error}. Probá instalar de nuevo desde el install link.`,
      false,
    );
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return page(
      "Falta el código",
      "El redirect llegó sin código de autorización. Volvé a iniciar la instalación.",
      false,
    );
  }

  // La instalación quedó autorizada. No intercambiamos el code (no necesitamos
  // el token: enviamos con el PIT y recibimos por webhook).
  return page(
    "App instalada",
    "La integración quedó conectada. Ya podés cerrar esta pestaña.",
    true,
  );
}
