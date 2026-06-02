import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio, TranscriptionError } from "@/lib/transcription";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ===========================================================================
// POST /api/transcribe
//
// Body: multipart/form-data con campo `file` (Blob de audio).
// Opcional: campo `language` (ISO-639-1, default 'es').
//
// Devuelve { text: string }. Usado por el composer del panel de testing
// para grabar audios via MediaRecorder y enviarlos como mensaje user.
// ===========================================================================

const MAX_BYTES = 25 * 1024 * 1024; // 25MB, límite de Whisper

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Body debe ser multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Falta el campo 'file' o no es un blob" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Archivo excede 25MB (size=${file.size})` },
      { status: 413 },
    );
  }

  const languageRaw = form.get("language");
  const language = typeof languageRaw === "string" && languageRaw.length > 0
    ? languageRaw
    : "es";

  const mimeType = file.type || "audio/webm";
  const filename = pickFilename(mimeType);

  try {
    const text = await transcribeAudio(file, { language, filename, mimeType });
    return NextResponse.json({ text });
  } catch (err) {
    const message =
      err instanceof TranscriptionError
        ? err.message
        : "Error desconocido al transcribir";
    console.error("[api/transcribe] fallo:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Whisper deduce el formato del codec por la extensión del filename.
// Mapeamos los mime types que MediaRecorder genera en navegador + los que
// envía Baileys para audios de WhatsApp.
function pickFilename(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("ogg") || lower.includes("opus")) return "voice.ogg";
  if (lower.includes("webm")) return "voice.webm";
  if (lower.includes("mp3") || lower.includes("mpeg")) return "voice.mp3";
  if (lower.includes("mp4") || lower.includes("aac") || lower.includes("m4a"))
    return "voice.m4a";
  if (lower.includes("wav")) return "voice.wav";
  return "voice.webm";
}
