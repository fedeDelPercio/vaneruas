"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, ArrowUp, Bot, Loader2, UserRound } from "lucide-react";
import type { Message } from "@/lib/supabase/types";
import type { ConversationMode } from "./ModeToggle";
import { useProfile } from "../ProfileProvider";

// Cuadro de texto del chat de WhatsApp. Lo que se escribe acá le llega a la
// clienta por WhatsApp, firmado por el equipo (POST /api/wa/messages/[id]).
//
// Con Valentina activa no se escribe: primero hay que tomar la conversación.
// Si no, ella contestaría encima del equipo en el próximo mensaje.

const DAY_MS = 24 * 60 * 60 * 1000;

export function WaComposer({
  conversationId,
  mode,
  modeBusy,
  onTake,
  onRelease,
  onSent,
  lastCustomerMessageAt,
}: {
  conversationId: string;
  mode: ConversationMode;
  modeBusy: boolean;
  /** Pasar la conversación al equipo. */
  onTake: () => void;
  /** Devolvérsela a Valentina. */
  onRelease: () => void;
  /** `ghlSynced: false` = el mensaje salió pero no se pudo marcar la conversación en GHL. */
  onSent: (message: Message | null, ghlSynced: boolean) => void;
  /** Último mensaje de la clienta, para avisar de la ventana de 24 hs de WhatsApp. */
  lastCustomerMessageAt: string | null;
}) {
  const { profile } = useProfile();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // El último envío quedó sin confirmar: no reenviar a ciegas.
  const [uncertain, setUncertain] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // El textarea crece con el texto, hasta un tope.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, mode]);

  // Al tomar la conversación, el foco va directo a escribir.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current !== "HUMAN" && mode === "HUMAN") textareaRef.current?.focus();
    prevMode.current = mode;
  }, [mode]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/wa/messages/${conversationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // El perfil queda como quien atendió las intervenciones que se
        // resuelven solas con este envío.
        body: JSON.stringify({ content, profileId: profile?.id ?? null }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        uncertain?: boolean;
        message?: Message | null;
        ghlSynced?: boolean;
        pendingResolved?: boolean;
      };
      if (!r.ok) {
        setUncertain(Boolean(j.uncertain));
        toast.error(j.error ?? "No se pudo enviar el mensaje");
        return;
      }
      setUncertain(false);
      setText("");
      // Las intervenciones abiertas se resolvieron solas: badges y lista al día.
      if (j.pendingResolved) window.dispatchEvent(new Event("atp:notifications-changed"));
      onSent(j.message ?? null, j.ghlSynced !== false);
    } catch {
      setUncertain(true);
      toast.error("No se pudo confirmar el envío. Mirá si el mensaje salió antes de reenviarlo");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  if (mode === "AI") {
    return (
      <div className="border-t border-neutral-200 bg-white px-4 py-3.5 sm:px-8 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
            <Bot className="h-3.5 w-3.5 shrink-0 text-gold-fg dark:text-gold" strokeWidth={1.75} />
            Valentina está respondiendo esta conversación
          </p>
          <button
            onClick={onTake}
            disabled={modeBusy}
            className="flex shrink-0 items-center gap-1.5 btn-gold"
          >
            {modeBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <UserRound className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            Tomar conversación
          </button>
        </div>
      </div>
    );
  }

  const windowClosed =
    lastCustomerMessageAt !== null &&
    Date.now() - new Date(lastCustomerMessageAt).getTime() > DAY_MS;

  return (
    <div className="border-t border-neutral-200 bg-white px-4 py-3.5 sm:px-8 sm:py-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mb-2 flex items-center gap-2 text-[11.5px] text-neutral-500 dark:text-neutral-400">
        <UserRound className="h-3 w-3 shrink-0 text-warn" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">
          Respondés vos, Valentina en pausa
        </span>
        <button
          onClick={onRelease}
          disabled={modeBusy || sending}
          className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-neutral-600 underline-offset-2 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
        >
          Devolver a Valentina
        </button>
      </div>

      {(windowClosed || uncertain) && (
        <p className="mb-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warn-fg dark:text-warn">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          {uncertain
            ? "El último envío quedó sin confirmar. Antes de mandarlo de nuevo, fijate en GoHighLevel si salió: acá puede tardar unos minutos en aparecer"
            : "Pasaron más de 24 hs del último mensaje de la clienta. WhatsApp puede rechazar el envío"}
        </p>
      )}

      <div className="flex items-end gap-2 rounded-lg border border-neutral-200 bg-white p-1.5 pl-3.5 transition focus-within:border-gold/60 focus-within:shadow-gold-sm dark:border-neutral-800 dark:bg-neutral-900">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Escribile a la clienta"
          aria-label="Mensaje para la clienta"
          style={{ boxShadow: "none" }}
          className="scroll-thin min-h-[36px] flex-1 resize-none self-center !border-0 bg-transparent py-2 text-[16px] leading-relaxed outline-none sm:text-[13.5px] placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          aria-label="Enviar por WhatsApp"
          title="Enviar por WhatsApp (Enter)"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-gold-start text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      </div>
      <p className="mt-1.5 hidden px-1 text-[10.5px] text-neutral-400 sm:block dark:text-neutral-500">
        Enter envía · Shift + Enter hace un salto de línea
      </p>
    </div>
  );
}
