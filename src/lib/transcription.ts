// ===========================================================================
// Transcripción de audio via OpenAI Whisper.
//
// Se usa desde dos lugares:
//   - API route /api/transcribe (uploads del panel de testing).
//   - bot wa-bot (audios entrantes de WhatsApp, push-to-talk o audioMessage).
//
// La key se lee perezosamente: si no está configurada, lanza error claro
// pero no rompe el resto del sistema.
// ===========================================================================

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-1";

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export interface TranscribeOptions {
  /** Idioma ISO-639-1 (ej "es"). Acelera y mejora precisión. */
  language?: string;
  /** Nombre de archivo + extensión real (ej "voice.ogg"). Whisper lo usa
   * para deducir el codec; con extensión genérica falla. */
  filename: string;
  /** MIME type real del audio (ej "audio/ogg", "audio/webm"). */
  mimeType: string;
}

export async function transcribeAudio(
  audio: Buffer | Blob,
  options: TranscribeOptions,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TranscriptionError(
      "OPENAI_API_KEY no configurada. Agregala a .env.local para habilitar transcripción de audio.",
    );
  }

  const blob =
    audio instanceof Blob
      ? audio
      : new Blob([new Uint8Array(audio)], { type: options.mimeType });

  const form = new FormData();
  form.append("file", blob, options.filename);
  form.append("model", DEFAULT_MODEL);
  if (options.language) form.append("language", options.language);

  let res: Response;
  try {
    res = await fetch(WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new TranscriptionError("Error de red llamando a Whisper", err);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "(sin cuerpo)");
    throw new TranscriptionError(
      `Whisper devolvió ${res.status}: ${detail.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as { text?: unknown };
  if (typeof json.text !== "string") {
    throw new TranscriptionError("Whisper no devolvió un campo text válido");
  }
  return json.text.trim();
}
