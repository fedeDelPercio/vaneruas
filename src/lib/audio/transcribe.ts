import "server-only";

import { serverEnv } from "@/lib/env";

// ===========================================================================
// Transcripción de audios de WhatsApp (notas de voz) con OpenAI Whisper.
//
// Los audios entran por GHL como adjunto (.ogg/opus). El inbound baja los
// bytes y los pasa por acá para obtener el texto, así el agente entiende lo
// que dijo la persona en vez de recibir un placeholder genérico.
//
// Se llama a la API REST de OpenAI con multipart directo (fetch + FormData,
// nativos en Node 20) para no sumar el SDK: este proyecto es Anthropic-only y
// esto es una llamada de transcripción aislada, no una llamada a un LLM.
//
// Fail-soft: si la key no está, el audio no es válido, o la API falla,
// devuelve null. El inbound cae a un placeholder y el agente pide que lo
// escriban (nunca rompe el flujo).
// ===========================================================================

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIBE_TIMEOUT_MS = 30000;

// Tope defensivo: las notas de voz de WhatsApp son chicas; rechazamos archivos
// absurdos antes de mandarlos (Whisper acepta hasta 25 MB).
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Extensión por content-type para que OpenAI infiera el formato del archivo.
const EXT_BY_AUDIO_TYPE: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/amr": "amr",
};

export function isAudioType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("audio/");
}

/**
 * Transcribe un audio a texto. Devuelve el texto (trim) o null si no se pudo
 * (sin key, audio inválido, error de la API). Nunca lanza.
 */
export async function transcribeAudio(args: {
  bytes: Buffer;
  contentType: string;
}): Promise<string | null> {
  const apiKey = serverEnv().OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!args.bytes.length || args.bytes.length > MAX_AUDIO_BYTES) return null;

  try {
    const ext = EXT_BY_AUDIO_TYPE[args.contentType.toLowerCase()] ?? "ogg";
    const form = new FormData();
    const blob = new Blob([new Uint8Array(args.bytes)], { type: args.contentType });
    form.append("file", blob, `audio.${ext}`);
    form.append("model", serverEnv().OPENAI_TRANSCRIBE_MODEL);
    // Sesgo a español rioplatense: el público del cliente habla español.
    form.append("language", "es");

    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[transcribe] OpenAI ${res.status}: ${detail.slice(0, 300)}`);
      return null;
    }

    const data = (await res.json().catch(() => null)) as { text?: string } | null;
    const text = data?.text?.trim();
    return text ? text : null;
  } catch (err) {
    console.error(
      "[transcribe] no se pudo transcribir el audio:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
