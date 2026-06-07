"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { ArrowUp, Loader2, Mic, Paperclip, Square, X } from "lucide-react";

// Tipos de comprobante aceptados (espejo de ALLOWED_COMPROBANTE_TYPES del server).
const ACCEPTED_ATTACHMENT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

// Composer del panel. Manda el mensaje al webhook entrante (igual que haria
// WhatsApp en fase 2). La respuesta del agente llega por Realtime.
//
// Además soporta grabación de audio: el usuario aprieta el micrófono, graba,
// frena, y la transcripción de Whisper aparece en el textarea para revisar
// antes de enviar.

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function pickFile(selected: File | null) {
    if (!selected) return;
    if (!ACCEPTED_ATTACHMENT.split(",").includes(selected.type)) {
      toast.error("Formato no soportado. Subí una imagen o un PDF.");
      return;
    }
    if (selected.size > MAX_ATTACHMENT_BYTES) {
      toast.error("El archivo es muy grande (máx 8 MB).");
      return;
    }
    setFile(selected);
  }

  async function send() {
    const content = text.trim();
    if ((!content && !file) || sending) return;
    setSending(true);
    try {
      // Si hay un comprobante adjunto, primero lo subimos al bucket privado.
      let attachmentPath: string | undefined;
      let attachmentType: string | undefined;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("conversationId", conversationId);
        const up = await fetch("/api/comprobantes/upload", { method: "POST", body: form });
        const upData = await up.json();
        if (!up.ok) {
          toast.error(upData.error ?? "No se pudo subir el comprobante");
          return;
        }
        attachmentPath = upData.path;
        attachmentType = upData.type;
      }

      const res = await fetch("/api/webhooks/incoming", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          content,
          source: "panel",
          attachmentPath,
          attachmentType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo enviar el mensaje");
        return;
      }
      setText("");
      setFile(null);
    } catch {
      toast.error("Error de red al enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  async function startRecording() {
    if (recording || transcribing) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Tu navegador no soporta grabación de audio");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("No se pudo acceder al micrófono. Revisá los permisos.");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => void handleStop();
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }

  async function handleStop() {
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    chunksRef.current = [];
    if (blob.size === 0) {
      toast.error("La grabación quedó vacía");
      return;
    }
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", blob, "voice.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo transcribir el audio");
        return;
      }
      const transcribed = (data.text as string)?.trim();
      if (!transcribed) {
        toast.error("Whisper no devolvió texto. Probá hablar más fuerte.");
        return;
      }
      // Lo agregamos al final del texto existente para no pisarlo si el
      // usuario estaba escribiendo.
      setText((prev) => (prev ? `${prev} ${transcribed}` : transcribed));
    } catch {
      toast.error("Error de red al transcribir");
    } finally {
      setTranscribing(false);
    }
  }

  const canSend = !sending && (!!text.trim() || !!file);
  const micDisabled = sending || transcribing || !!file;
  const attachDisabled = sending || recording || transcribing;

  return (
    <div className="border-t border-neutral-200 bg-white px-4 py-4 sm:px-8 sm:py-5 dark:border-neutral-800 dark:bg-neutral-950">
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11.5px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
          <Paperclip className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{file.name}</span>
          <button
            onClick={() => setFile(null)}
            className="ml-auto shrink-0 rounded-sm p-0.5 transition hover:bg-neutral-200 dark:hover:bg-neutral-800"
            aria-label="Quitar adjunto"
          >
            <X className="h-3 w-3" strokeWidth={1.75} />
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_ATTACHMENT}
        className="hidden"
        onChange={(e) => {
          pickFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <div className="flex items-end gap-2 rounded-md border border-neutral-200 bg-white p-1.5 pl-3.5 transition focus-within:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-600">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={
            recording
              ? "Grabando…"
              : transcribing
                ? "Transcribiendo…"
                : file
                  ? "Agregá un mensaje (opcional)"
                  : "Escribí como si fueras el cliente"
          }
          disabled={recording || transcribing}
          className="scroll-thin max-h-32 min-h-[36px] flex-1 resize-none self-center bg-transparent py-2 text-[13.5px] outline-none placeholder:text-neutral-400 disabled:opacity-60 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={attachDisabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          aria-label="Adjuntar comprobante"
          title="Adjuntar comprobante"
        >
          <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          onClick={recording ? stopRecording : startRecording}
          disabled={micDisabled}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition disabled:opacity-40 ${
            recording
              ? "animate-pulse bg-rose-500 text-white hover:bg-rose-600"
              : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          }`}
          aria-label={recording ? "Detener grabación" : "Grabar audio"}
          title={recording ? "Detener grabación" : "Grabar audio"}
        >
          {transcribing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : recording ? (
            <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
        <button
          onClick={send}
          disabled={!canSend}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-950 dark:hover:bg-neutral-200"
          aria-label="Enviar"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}

// El navegador puede no soportar todos los mime types. Whisper acepta varios,
// pero webm/opus es el de mejor soporte y peso en Chrome/Edge/Firefox.
function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}
