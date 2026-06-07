import { NextRequest, NextResponse } from "next/server";
import {
  uploadComprobante,
  isAllowedComprobanteType,
  MAX_COMPROBANTE_BYTES,
  ALLOWED_COMPROBANTE_TYPES,
} from "@/lib/payments/storage";

export const dynamic = "force-dynamic";

// ===========================================================================
// POST /api/comprobantes/upload  (multipart/form-data)
//
// Sube un comprobante al bucket privado y devuelve el path en Storage. Lo usa
// el composer del panel para probar el flujo de pago end-to-end; en producción
// el provider de GHL hará lo análogo (bajar la imagen de WhatsApp y subirla).
// Campos: file (requerido), conversationId (opcional, para namespacear).
// ===========================================================================

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Form-data inválido" }, { status: 400 });
  }

  const file = form.get("file");
  const conversationId = (form.get("conversationId") as string) || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (!isAllowedComprobanteType(file.type)) {
    return NextResponse.json(
      { error: `Tipo no permitido. Aceptados: ${ALLOWED_COMPROBANTE_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_COMPROBANTE_BYTES) {
    return NextResponse.json(
      { error: `El archivo supera el máximo de ${MAX_COMPROBANTE_BYTES / (1024 * 1024)} MB` },
      { status: 400 },
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const path = await uploadComprobante({
      bytes,
      contentType: file.type,
      conversationId,
    });
    return NextResponse.json({ path, type: file.type }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al subir";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
