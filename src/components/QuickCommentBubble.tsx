"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Minus,
  X,
  ArrowUp,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import type { CommentKind } from "@/lib/supabase/types";

// Burbuja con dos pasos dentro del mismo recuadro:
// 1. Menú vertical compacto: elegir Positivo / Neutro / Negativo.
// 2. Tras elegir: header con back + sentimiento + cerrar, textarea opcional
//    y send. El voto se dispara apenas se elige (sin esperar texto), así si
//    el usuario cierra sin escribir, el voto igual queda guardado.

type Sentiment = "positive" | "neutral" | "negative";

const SENTIMENT_TO_KIND: Record<Sentiment, CommentKind> = {
  positive: "positive",
  neutral: "note",
  negative: "negative",
};

type OptionConfig = {
  id: Sentiment;
  label: string;
  Icon: typeof Check;
  text: string;
  hoverText: string;
};

const OPTIONS: OptionConfig[] = [
  {
    id: "positive",
    label: "Positivo",
    Icon: Check,
    text: "text-emerald-700 dark:text-emerald-300",
    hoverText: "hover:text-emerald-700 dark:hover:text-emerald-300",
  },
  {
    id: "neutral",
    label: "Neutro",
    Icon: Minus,
    text: "text-neutral-900 dark:text-neutral-50",
    hoverText: "hover:text-neutral-900 dark:hover:text-neutral-50",
  },
  {
    id: "negative",
    label: "Negativo",
    Icon: X,
    text: "text-rose-700 dark:text-rose-300",
    hoverText: "hover:text-rose-700 dark:hover:text-rose-300",
  },
];

export function QuickCommentBubble({
  side,
  currentSentiment,
  onSubmit,
  onClose,
}: {
  side: "left" | "right"; // dónde se posiciona respecto al bubble del mensaje
  // Si el usuario ya tiene voto previo, arrancamos directo en el step 2 con
  // ese sentimiento; así puede actualizar el comentario o ir back para cambiar
  // el voto.
  currentSentiment?: Sentiment;
  onSubmit: (kind: CommentKind, content: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Sentiment | null>(
    currentSentiment ?? null,
  );
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // ESC cierra.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pickSentiment(s: Sentiment) {
    // Disparamos el voto inmediato (sin content). Si el user cierra sin
    // escribir, el voto igual quedó guardado. Si después escribe y manda,
    // se actualiza el content del mismo voto.
    void onSubmit(SENTIMENT_TO_KIND[s], null);
    setPicked(s);
  }

  function goBack() {
    setPicked(null);
    setText("");
  }

  async function sendComment() {
    if (!picked || sending) return;
    const content = text.trim();
    if (!content) {
      // Sin texto pero ya votó al hacer pick: cerramos sin pegarle al backend.
      onClose();
      return;
    }
    setSending(true);
    try {
      await onSubmit(SENTIMENT_TO_KIND[picked], content);
      onClose();
    } finally {
      setSending(false);
    }
  }

  // STEP 1: menú vertical de selección.
  if (!picked) {
    return (
      <>
        {/* Overlay transparente fullscreen: captura el click-afuera para
            cerrar la burbuja. Más confiable que un document listener
            (no compite con el bubbling del click que dispara setPicked). */}
        <div
          className="fixed inset-0 z-30"
          onClick={onClose}
          aria-hidden
        />
        <div
          className={`relative z-40 w-40 shrink-0 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark ${
            side === "left" ? "mr-1" : "ml-1"
          }`}
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            return (
              <button
                key={opt.id}
                onClick={() => pickSentiment(opt.id)}
                className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] text-neutral-600 transition hover:bg-neutral-50 ${opt.hoverText} dark:text-neutral-400 dark:hover:bg-neutral-800/60`}
              >
                <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  // STEP 2: header (back + sentimiento + cerrar) + textarea + send.
  const opt = OPTIONS.find((o) => o.id === picked)!;
  const Icon = opt.Icon;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        className={`relative z-40 w-64 shrink-0 rounded-md border border-neutral-200 bg-white p-2 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark ${
          side === "left" ? "mr-1" : "ml-1"
        }`}
      >
      <div className="flex items-center justify-between gap-2 px-0.5">
        <button
          onClick={goBack}
          title="Cambiar reacción"
          className="flex items-center gap-1.5 rounded-md py-0.5 text-neutral-500 transition hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={1.75} />
          <Icon className={`h-3 w-3 ${opt.text}`} strokeWidth={2} />
          <span className={`text-[11.5px] font-medium ${opt.text}`}>
            {opt.label}
          </span>
        </button>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-neutral-400 transition hover:text-neutral-700 dark:hover:text-neutral-200"
          aria-label="Cerrar"
        >
          <X className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </div>
      <div className="mt-2 flex items-end gap-1.5 rounded-md border border-neutral-200 bg-white p-1 transition focus-within:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:focus-within:border-neutral-600">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendComment();
            }
          }}
          rows={2}
          placeholder="Comentario opcional"
          className="scroll-thin max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[12px] outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          onClick={() => void sendComment()}
          disabled={sending || !text.trim()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-950 dark:hover:bg-neutral-200"
          aria-label="Enviar comentario"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      </div>
      </div>
    </>
  );
}
