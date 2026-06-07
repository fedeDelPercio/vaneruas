import "server-only";

import { randomUUID } from "crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

// ===========================================================================
// Storage de comprobantes de pago.
//
// Bucket privado `comprobantes` (ver migration 012). Acceso server-side con el
// admin client (service_role): el bucket es privado y las imágenes solo se
// sirven via signed URLs de vida corta. Los paths se namespacean por
// client_slug para aislar por cliente en el proyecto Supabase compartido:
//   <client_slug>/<conversationId>/<uuid>.<ext>
//
// (Excepción documentada al "no usar service_role en runtime": Storage no tiene
// columna client_slug para RLS por fila; el aislamiento se hace por path. Si
// más adelante se quiere endurecer, se pueden sumar policies sobre
// storage.objects keyeadas en current_client_slug() y pasar al scoped client.)
// ===========================================================================

export const COMPROBANTES_BUCKET = "comprobantes";

// Tipos permitidos: imágenes comunes de captura + PDF (Claude vision lee ambos).
export const ALLOWED_COMPROBANTE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

// Límite de tamaño. Base64 a la API de Anthropic tope ~5MB por imagen; dejamos
// margen y rechazamos archivos absurdos antes de subirlos.
export const MAX_COMPROBANTE_BYTES = 8 * 1024 * 1024; // 8 MB

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

export function isAllowedComprobanteType(type: string): boolean {
  return (ALLOWED_COMPROBANTE_TYPES as readonly string[]).includes(type);
}

/**
 * Sube el comprobante al bucket privado y devuelve el path guardado.
 * `conversationId` puede ser null (se agrupa en "_sueltos").
 */
export async function uploadComprobante(args: {
  bytes: Buffer;
  contentType: string;
  conversationId: string | null;
}): Promise<string> {
  const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;
  const ext = EXT_BY_TYPE[args.contentType] ?? "bin";
  const convFolder = args.conversationId ?? "_sueltos";
  const path = `${slug}/${convFolder}/${randomUUID()}.${ext}`;

  const { error } = await getSupabaseAdminClient()
    .storage.from(COMPROBANTES_BUCKET)
    .upload(path, args.bytes, {
      contentType: args.contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`No se pudo subir el comprobante: ${error.message}`);
  }
  return path;
}

/** Descarga el comprobante como Buffer (para pasarlo al extractor de vision). */
export async function downloadComprobante(path: string): Promise<Buffer> {
  const { data, error } = await getSupabaseAdminClient()
    .storage.from(COMPROBANTES_BUCKET)
    .download(path);
  if (error || !data) {
    throw new Error(
      `No se pudo descargar el comprobante: ${error?.message ?? "vacío"}`,
    );
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Genera una signed URL de vida corta para mostrar el comprobante en el panel. */
export async function getComprobanteSignedUrl(
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient()
    .storage.from(COMPROBANTES_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
