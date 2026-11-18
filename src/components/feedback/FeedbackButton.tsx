"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import {
  Bug,
  ImagePlus,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  Mic,
  Square,
  X,
} from "lucide-react";
import { useProfile } from "../ProfileProvider";
import { useAudioDictation } from "./useAudioDictation";
import { shrinkImage } from "./shrinkImage";

// Botón de feedback del panel (menú lateral / barra superior en celular). Lo que se escribe (o se graba) acá llega como
// ticket al proyecto de Vanesa Rúas en AI ScaleMap, con las capturas, quién lo
// manda y desde qué pantalla. Dos tipos: Mejora (una idea o algo para cambiar)
// y Bug (algo que no anda).
//
// Cerrar no borra: el borrador queda guardado hasta enviarlo o descartarlo
// (el botón muestra un punto mientras tanto).

type Kind = "mejora" | "bug";

const KINDS: { value: Kind; label: string; Icon: typeof Bug }[] = [
  { value: "mejora", label: "Mejora", Icon: Lightbulb },
  { value: "bug", label: "Bug", Icon: Bug },
];

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Archivos más grandes que esto ni se intentan achicar (memoria del navegador).
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

interface Shot {
  id: string;
  file: File;
  url: string;
}

function fmtClock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Pantalla actual, sin datos de la persona buscada (?q= puede ser un teléfono). */
function currentPage(): string {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  return id ? `${window.location.pathname}?id=${id}` : window.location.pathname;
}

export function FeedbackButton() {
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [kind, setKind] = useState<Kind>("mejora");
  const [body, setBody] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  const dictation = useAudioDictation((text) => {
    setBody((prev) => {
      const base = prev.replace(/[ \t]+$/, "");
      if (!base) return text;
      return base.endsWith("\n") ? base + text : `${base} ${text}`;
    });
  });

  const hasDraft = body.trim().length > 0 || shots.length > 0;
  const busyAudio = dictation.state !== "idle";

  // Cerrar con una grabación en curso la detiene: lo grabado se transcribe
  // igual y queda en el borrador.
  const stopDictation = dictation.stop;
  const recordingRef = useRef(false);
  recordingRef.current = dictation.state === "recording";
  const close = useCallback(() => {
    if (recordingRef.current) stopDictation();
    setOpen(false);
  }, [stopDictation]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // Escape cierra; la página de atrás no scrollea con el cuadro abierto.
  const sendingRef = useRef(false);
  sendingRef.current = sending;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sendingRef.current) close();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;
      const room = MAX_IMAGES - shots.length;
      if (room <= 0) {
        toast.error(`Hasta ${MAX_IMAGES} capturas por envío`);
        return;
      }
      if (images.length > room) toast.error(`Entraron ${room}: el máximo es ${MAX_IMAGES} capturas`);
      setAdding(true);
      const next: Shot[] = [];
      for (const original of images.slice(0, room)) {
        if (original.size > MAX_SOURCE_BYTES) {
          toast.error("Esa imagen es demasiado grande");
          continue;
        }
        // Primero se achica: una captura de un monitor grande puede pasar los
        // 8 MB en PNG y quedar en unos cientos de KB.
        const file = await shrinkImage(original);
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error("Cada captura tiene que pesar menos de 8 MB");
          continue;
        }
        next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
      }
      setShots((prev) => [...prev, ...next]);
      setAdding(false);
    },
    [shots.length],
  );

  // Ctrl+V con una imagen en el portapapeles, en cualquier lugar del cuadro.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      e.preventDefault();
      void addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, addFiles]);

  function removeShot(id: string) {
    setShots((prev) => {
      const gone = prev.find((s) => s.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((s) => s.id !== id);
    });
  }

  function reset() {
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    setShots([]);
    setBody("");
    setKind("mejora");
  }

  function discard() {
    if (dictation.state === "recording") dictation.stop();
    reset();
    setOpen(false);
  }

  const totalBytes = shots.reduce((sum, s) => sum + s.file.size, 0);
  const tooHeavy = totalBytes > MAX_TOTAL_BYTES;
  const canSend = !sending && !busyAudio && !adding && !tooHeavy && hasDraft && Boolean(profile);

  async function send() {
    if (!canSend || !profile) return;
    setSending(true);
    try {
      const form = new FormData();
      form.set("profileId", profile.id);
      form.set("kind", kind);
      form.set("body", body.trim());
      form.set("page", currentPage());
      for (const s of shots) form.append("images", s.file, s.file.name || "captura.png");
      const res = await fetch("/api/tickets", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { number?: number; error?: string };
      if (!res.ok || typeof data.number !== "number") {
        toast.error(data.error ?? "No se pudo mandar. Probá de nuevo en un rato");
        return;
      }
      toast.success(`Listo, quedó como ticket #${data.number}. Gracias`);
      reset();
      setOpen(false);
    } catch {
      toast.error("Error de red. Tu borrador sigue acá, probá de nuevo");
    } finally {
      setSending(false);
    }
  }

  const sendHint = busyAudio
    ? dictation.state === "recording"
      ? "Detené la grabación para enviar"
      : "Esperá a que termine de pasar el audio a texto"
    : tooHeavy
      ? "Las capturas pesan demasiado juntas. Sacá alguna"
      : null;

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !sending) close();
      }}
      className={`fixed inset-0 z-[90] items-end justify-center bg-neutral-900/40 p-3 backdrop-blur-sm sm:items-center sm:p-6 ${
        open ? "flex" : "hidden"
      }`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
        className={`flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border bg-white shadow-soft dark:bg-neutral-900 dark:shadow-soft-dark ${
          dragging ? "border-gold/60" : "border-neutral-200 dark:border-neutral-800"
        }`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Feedback del panel
            </p>
            <h2
              id="feedback-title"
              className="mt-1 text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50"
            >
              Contanos qué notaste
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            title="Cerrar (queda guardado)"
            className="-mr-1.5 rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-4">
          <div
            role="radiogroup"
            aria-label="Tipo"
            className="inline-grid grid-cols-2 gap-0.5 self-start rounded-lg border border-neutral-200 bg-neutral-100/60 p-0.5 dark:border-neutral-800 dark:bg-neutral-950/60"
          >
            {KINDS.map(({ value, label, Icon }) => {
              const selected = kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setKind(value)}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    selected
                      ? "bg-white text-neutral-900 shadow-sm ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:ring-neutral-700"
                      : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 ${selected ? (value === "bug" ? "text-red-600 dark:text-red-400" : "text-gold-fg dark:text-gold") : ""}`}
                    strokeWidth={1.75}
                  />
                  {label}
                </button>
              );
            })}
          </div>

          <div>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              maxLength={20000}
              rows={6}
              placeholder={
                kind === "bug"
                  ? "Qué pasó, dónde y qué esperabas que pasara. También lo podés grabar"
                  : "Qué cambiarías o qué te gustaría que haga el panel. También lo podés grabar"
              }
              aria-label="Detalle"
              className="min-h-[140px] w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-[16px] leading-relaxed text-neutral-900 outline-none transition placeholder:text-neutral-400 sm:text-[13.5px] dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />

            {dictation.supported && (
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                {dictation.state === "recording" ? (
                  <button
                    type="button"
                    onClick={dictation.stop}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-red-700"
                  >
                    <Square className="h-3 w-3" strokeWidth={2.5} />
                    Detener
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void dictation.start()}
                    disabled={dictation.state === "transcribing" || sending}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {dictation.state === "transcribing" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    {dictation.state === "transcribing" ? "Pasando a texto…" : "Grabar audio"}
                  </button>
                )}
                {dictation.state === "recording" ? (
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                    Grabando {fmtClock(dictation.seconds)}
                    <span className="text-neutral-400 dark:text-neutral-600">
                      / {fmtClock(dictation.maxSeconds)}
                    </span>
                  </span>
                ) : (
                  dictation.state === "idle" && (
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                      Se escribe tal cual lo digas
                    </span>
                  )
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {shots.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {shots.map((s) => (
                  <div key={s.id} className="relative">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" title="Ver captura">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.url}
                        alt="Captura adjunta"
                        className="h-16 w-16 rounded-lg border border-neutral-200 object-cover dark:border-neutral-800"
                      />
                    </a>
                    <button
                      type="button"
                      onClick={() => removeShot(s.id)}
                      aria-label="Quitar captura"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-50"
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={adding || shots.length >= MAX_IMAGES}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-neutral-50"
              >
                {adding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                {adding ? "Preparando…" : shots.length ? "Otra captura" : "Adjuntar captura"}
              </button>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                o pegala con{" "}
                <kbd className="rounded border border-neutral-300 px-1 font-mono text-[10px] dark:border-neutral-700">
                  Ctrl
                </kbd>
                +
                <kbd className="rounded border border-neutral-300 px-1 font-mono text-[10px] dark:border-neutral-700">
                  V
                </kbd>
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 px-5 py-3.5 dark:border-neutral-800">
          {sendHint ? (
            <span className="mr-auto text-[11.5px] text-warn-fg dark:text-warn">{sendHint}</span>
          ) : hasDraft ? (
            <button
              type="button"
              onClick={discard}
              disabled={sending}
              className="mr-auto rounded-lg px-2 py-1.5 text-[12px] text-neutral-500 transition hover:text-neutral-900 disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-50"
            >
              Descartar
            </button>
          ) : (
            <span className="mr-auto hidden text-[11px] text-neutral-400 sm:inline dark:text-neutral-500">
              Llega como ticket a AI ScaleMap ·{" "}
              <kbd className="rounded border border-neutral-300 px-1 font-mono text-[10px] dark:border-neutral-700">
                Ctrl
              </kbd>
              +
              <kbd className="rounded border border-neutral-300 px-1 font-mono text-[10px] dark:border-neutral-700">
                Enter
              </kbd>{" "}
              envía
            </span>
          )}
          <button type="submit" disabled={!canSend} className="flex items-center gap-1.5 btn-gold">
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={hasDraft ? "Feedback del panel (tenés un borrador)" : "Mandar una mejora o un bug"}
        title={hasDraft ? "Tenés un borrador sin enviar" : "Mandar una mejora o un bug"}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
      >
        <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />
        {(hasDraft || busyAudio) && (
          <span
            aria-hidden
            className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
              dictation.state === "recording" ? "animate-pulse bg-red-500" : "bg-gold"
            }`}
          />
        )}
      </button>
      {/* Al body: el header tiene backdrop-blur, y un fixed adentro queda atado
          al header y no a la pantalla. Siempre montado: así el borrador y una
          transcripción en curso sobreviven a cerrar el cuadro. */}
      {mounted && createPortal(dialog, document.body)}
    </>
  );
}
