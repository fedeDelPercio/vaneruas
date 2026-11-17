"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

// Grabar y pasar a texto. Se graba con el micrófono del navegador y, al
// detener, el audio va a /api/transcribe (el mismo que usa el panel para los
// audios) y vuelve el texto tal cual se dijo: nadie lo reescribe ni lo
// resume. El audio no se guarda.

export type DictationState = "idle" | "recording" | "transcribing";

/** Tope de una grabación. A los 5 minutos se detiene sola y transcribe. */
const MAX_SECONDS = 300;

/** El navegador no soporta todos los formatos; webm/opus es el más común. */
function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

export function useAudioDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Al desmontar se corta sin transcribir.
  const discardRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const releaseMic = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setState("transcribing");
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("file", blob, `feedback.${ext}`);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo pasar el audio a texto");
        return;
      }
      const text = data.text?.trim();
      if (!text) {
        toast.error("No se entendió nada en la grabación. Probá hablar más cerca del micrófono");
        return;
      }
      onTextRef.current(text);
    } catch {
      toast.error("Error de red al pasar el audio a texto");
    } finally {
      setState("idle");
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    releaseMic();
  }, [releaseMic]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    if (!supported) {
      toast.error("Este navegador no permite grabar audio");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("No se pudo usar el micrófono. Revisá los permisos del navegador");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    discardRef.current = false;
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      chunksRef.current = [];
      recorderRef.current = null;
      if (discardRef.current) return;
      if (blob.size === 0) {
        setState("idle");
        toast.error("La grabación quedó vacía");
        return;
      }
      void transcribe(blob);
    };
    recorder.start();
    recorderRef.current = recorder;
    setSeconds(0);
    setState("recording");
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, [state, supported, transcribe]);

  // Tope de duración: se detiene sola y transcribe lo grabado.
  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) stop();
  }, [state, seconds, stop]);

  useEffect(
    () => () => {
      discardRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      releaseMic();
    },
    [releaseMic],
  );

  return { state, seconds, supported, start, stop, maxSeconds: MAX_SECONDS };
}
