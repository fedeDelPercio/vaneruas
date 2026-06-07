"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Bell, FileText } from "lucide-react";
import type { Message, CommentKind } from "@/lib/supabase/types";
import type { ViewMode } from "@/lib/profile";
import { MessageTrace } from "./MessageTrace";
import {
  MessageReactions,
  EMPTY_REACTION,
  type MessageReactionState,
} from "./MessageReactions";
import { QuickCommentBubble } from "./QuickCommentBubble";

// Burbuja de un mensaje. En vista avanzada, los mensajes del agente con trace
// se pueden expandir para ver el detalle agentico.

// Regex de URLs http(s) razonablemente conservador: matchea hasta el primer
// caracter "raro" (espacio, parentesis, punto y aparte). Captura signos de
// puntuacion comunes al final solo si vienen pegados.
const URL_REGEX = /https?:\/\/[^\s<>()]+/g;

/**
 * Renderiza un texto convirtiendo URLs en <a> clickeables. Preserva el resto
 * del contenido tal cual (incluye saltos de linea via whitespace-pre-wrap del
 * contenedor). Para evitar links rotos por puntuacion final, recorta `.,;:!?)`
 * trailing del match.
 */
function renderWithLinks(content: string, isUser: boolean): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const linkClass = isUser
    ? "underline underline-offset-2 decoration-1 opacity-90 hover:opacity-100"
    : "underline underline-offset-2 decoration-1 text-neutral-900 hover:decoration-2 dark:text-neutral-50";

  for (const match of content.matchAll(URL_REGEX)) {
    const rawUrl = match[0];
    const trimmed = rawUrl.replace(/[.,;:!?)\]]+$/, "");
    const trailing = rawUrl.slice(trimmed.length);
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(content.slice(lastIndex, start));
    }
    parts.push(
      <a
        key={`url-${key++}`}
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        {trimmed}
      </a>,
    );
    if (trailing) parts.push(trailing);
    lastIndex = start + rawUrl.length;
  }
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }
  return parts.length > 0 ? parts : content;
}

/**
 * Adjunto de un mensaje (comprobante de pago). El bucket es privado, así que
 * pedimos una signed URL de vida corta al endpoint y renderizamos la imagen
 * (o un link si es PDF).
 */
function ComprobanteAttachment({
  path,
  type,
}: {
  path: string;
  type: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/comprobantes/signed-url?path=${encodeURIComponent(path)}`,
        );
        const data = await res.json();
        if (active && res.ok && data.url) setUrl(data.url as string);
        else if (active) setFailed(true);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [path]);

  const isPdf = type === "application/pdf";

  if (failed) {
    return (
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-neutral-400">
        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
        Comprobante adjunto
      </div>
    );
  }
  if (!url) {
    return (
      <div className="mb-2 h-32 w-44 animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-800" />
    );
  }
  if (isPdf) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        Ver comprobante (PDF)
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Comprobante de pago"
        className="mb-2 max-h-64 w-auto rounded-md border border-neutral-200 object-contain dark:border-neutral-800"
      />
    </a>
  );
}

export function MessageBubble({
  message,
  viewMode,
  reactions,
  onSubmitReaction,
}: {
  message: Message;
  viewMode: ViewMode;
  reactions?: MessageReactionState;
  // El usuario abre el menú y elige sentimiento (positivo/neutro/negativo).
  // Al elegir, se dispara con content=null (voto inmediato). Si después
  // escribe un comentario y lo manda, se vuelve a llamar con content=texto
  // y el backend actualiza el comment existente.
  onSubmitReaction: (
    messageId: string,
    kind: CommentKind,
    content: string | null,
  ) => Promise<void>;
}) {
  const [traceOpen, setTraceOpen] = useState(false);
  // Al hacer click en el unico boton inline, abrimos la burbuja con el
  // selector de sentimiento.
  const [quickOpen, setQuickOpen] = useState(false);
  const state = reactions ?? EMPTY_REACTION;

  // Mensajes de sistema: el "cartel" de notificación al equipo. Pill discreta,
  // ícono con acento warn, fondo neutral (sin card amarilla).
  if (message.role === "system") {
    return (
      <div id={`message-${message.id}`} className="flex justify-center py-3">
        <div className="flex max-w-[92%] items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11.5px] tracking-tight-er text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
          <Bell className="h-3 w-3 shrink-0 text-warn" strokeWidth={1.75} />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";
  const isAgent = message.role === "assistant";
  const canExpand = viewMode === "advanced" && isAgent && Boolean(message.trace_id);

  // El boton inline solo abre la burbuja. La logica de elegir sentimiento y
  // mandar comentario vive dentro de QuickCommentBubble.
  // Las reacciones son herramientas internas del panel para que el equipo
  // evalue las respuestas del agente. NO se muestran sobre los mensajes del
  // cliente real — solo sobre los del asistente (los del sistema tienen su
  // propio render arriba).
  const showReactions = isAgent;
  const reactionsCol = showReactions ? (
    <MessageReactions state={state} onOpen={() => setQuickOpen(true)} />
  ) : null;

  // Si el usuario ya tiene un voto positivo o negativo, el item correspondiente
  // del menú se resalta como "estado actual". Note no se preselecciona (puede
  // haber varias notas por mensaje).
  const currentSentiment =
    state.myKind === "positive"
      ? "positive"
      : state.myKind === "negative"
        ? "negative"
        : undefined;

  // El menú se renderiza del lado del "borde libre" del mensaje: para mensajes
  // del agente (alineados a la izquierda), va a la DERECHA.
  const quickBubble = showReactions && quickOpen ? (
    <QuickCommentBubble
      side="right"
      currentSentiment={currentSentiment}
      onSubmit={(kind, content) => onSubmitReaction(message.id, kind, content)}
      onClose={() => setQuickOpen(false)}
    />
  ) : null;

  return (
    <div
      id={`message-${message.id}`}
      className={`flex items-end gap-1 px-1 py-0.5 ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div className="max-w-[85%] sm:max-w-[78%]">
        <div
          className={`whitespace-pre-wrap break-words rounded-md px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
            isUser
              ? "rounded-br-sm bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
              : "rounded-bl-sm border border-neutral-200 bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          }`}
        >
          {message.attachment_path && (
            <ComprobanteAttachment
              path={message.attachment_path}
              type={message.attachment_type}
            />
          )}
          {message.content.trim() && renderWithLinks(message.content, isUser)}
        </div>

        <div
          className={`mt-1 flex items-center gap-2 px-1 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 ${
            isUser ? "justify-end" : "justify-start"
          }`}
        >
          <span>
            {new Date(message.created_at).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>

          {canExpand && (
            <button
              onClick={() => setTraceOpen((v) => !v)}
              className="flex items-center gap-0.5 transition hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <ChevronRight
                className={`h-3 w-3 transition ${traceOpen ? "rotate-90" : ""}`}
                strokeWidth={1.75}
              />
              trace
            </button>
          )}
        </div>

        {traceOpen && canExpand && message.trace_id && (
          <MessageTrace traceId={message.trace_id} />
        )}
      </div>
      {!isUser && reactionsCol}
      {!isUser && quickBubble}
    </div>
  );
}
