"use client";

// Achica una captura antes de mandarla. Un pantallazo de un monitor grande
// pesa 1 a 3 MB en PNG, y el servidor corta los envíos de más de 4,5 MB: sin
// esto, dos o tres capturas ya no entraban. Se lleva a 2000 px de lado como
// máximo y a WebP (o JPEG si el navegador no sabe hacer WebP), que conserva
// bien el texto de una pantalla. Si no se puede achicar, queda la original.

const MAX_SIDE = 2000;
const SMALL_ENOUGH = 500 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function shrinkImage(file: File): Promise<File> {
  // Los GIF pueden ser animados: un canvas se queda con el primer cuadro.
  if (file.type === "image/gif" || file.size <= SMALL_ENOUGH) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    let blob = await toBlob(canvas, "image/webp", 0.9);
    // Safari devuelve PNG cuando no sabe hacer WebP: se prueba con JPEG.
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", 0.88);
    if (!blob || blob.size >= file.size) return file;
    const base = (file.name || "captura").replace(/\.[^.]+$/, "");
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `${base}.${ext}`, { type: blob.type });
  } catch {
    return file;
  }
}
