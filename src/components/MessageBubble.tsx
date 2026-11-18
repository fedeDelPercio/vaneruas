"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { MediaViewerModal, isImageType, isPdfType } from "./FileViewerModal";
import {
  AI_AUTHOR_LABEL,
  CUSTOMER_AUTHOR_LABEL,
  MessageAvatar,
  TEAM_AUTHOR_LABEL,
} from "./MessageAvatar";

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
function renderWithLinks(content: string, darkBubble: boolean): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const linkClass = darkBubble
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

// Las signed URLs del endpoint viven 5 minutos: si el visor se abre más tarde,
// se pide una nueva antes de mostrarlo.
const SIGNED_URL_FRESH_MS = 4 * 60_000;

async function fetchSignedUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/comprobantes/signed-url?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    return res.ok && data.url ? (data.url as string) : null;
  } catch {
    return null;
  }
}

/**
 * Adjunto de un mensaje (imagen o PDF). El bucket es privado: la signed URL de
 * vida corta la genera el server (/api/comprobantes/signed-url, que valida que
 * el path sea del client_slug activo).
 *
 * Se ve en miniatura (imagen recortada o tarjeta de PDF) y al click se abre el
 * visor modal único del panel, centrado en la misma página. El visor es estado
 * local de la burbuja: cerrar no navega, no remonta nada y no mueve el scroll
 * del chat ni de la lista.
 */
function MessageAttachment({
  path,
  type,
}: {
  path: string;
  type: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const fetchedAt = useRef(0);

  useEffect(() => {
    let active = true;
    void fetchSignedUrl(path).then((u) => {
      if (!active) return;
      if (u) {
        fetchedAt.current = Date.now();
        setUrl(u);
      } else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [path]);

  const isPdf = isPdfType(type);
  const isImage = !isPdf && isImageType(type);
  const kindLabel = isPdf ? "PDF" : isImage ? "Imagen" : "Archivo";
  const name = isPdf ? "Documento PDF" : isImage ? "Imagen adjunta" : "Archivo adjunto";

  function open() {
    setViewerOpen(true);
    if (Date.now() - fetchedAt.current > SIGNED_URL_FRESH_MS) {
      void fetchSignedUrl(path).then((u) => {
        if (!u) return;
        fetchedAt.current = Date.now();
        setUrl(u);
      });
    }
  }

  if (failed) {
    return (
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-neutral-400">
        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
        Archivo adjunto
      </div>
    );
  }
  if (!url) {
    return isImage ? (
      <div className="mb-2 h-32 w-44 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
    ) : (
      <div className="mb-2 h-14 w-56 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
    );
  }

  return (
    <>
      {isImage ? (
        <button
          type="button"
          onClick={open}
          title="Ver imagen"
          className="mb-2 block cursor-zoom-in overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 transition hover:opacity-90 hover:shadow-gold dark:border-neutral-800 dark:bg-neutral-900"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Imagen adjunta"
            loading="lazy"
            decoding="async"
            className="max-h-48 w-auto max-w-[240px] object-cover"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          title={`Ver ${kindLabel === "PDF" ? "PDF" : "archivo"}`}
          className="mb-2 flex w-full max-w-[260px] items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2.5 text-left transition hover:border-neutral-300 hover:shadow-gold dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
        >
          <span className="flex h-10 w-9 shrink-0 items-center justify-center rounded-md bg-red-600/10 text-red-700 dark:bg-red-500/15 dark:text-red-400">
            <FileText className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">
              {name}
            </span>
            <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              {kindLabel} · Ver
            </span>
          </span>
        </button>
      )}
      {viewerOpen && (
        <MediaViewerModal
          url={url}
          fileType={type}
          title={name}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
}

export function MessageBubble({
  message,
  viewMode,
  reactions,
  onSubmitReaction,
  perspective = "tester",
  showAuthor = true,
  customerName = null,
}: {
  message: Message;
  viewMode: ViewMode;
  /**
   * Desde dónde se mira la conversación.
   *  - "tester": banco de pruebas, quien escribe hace de cliente (cliente a la
   *    derecha, agente a la izquierda).
   *  - "team": bandeja real de WhatsApp. La clienta va a la izquierda y lo que
   *    sale de nuestro lado a la derecha, distinguiendo a Valentina del equipo.
   */
  perspective?: "tester" | "team";
  /** En "team": mostrar quién escribió (se apaga en mensajes seguidos del mismo autor). */
  showAuthor?: boolean;
  /** En "team": nombre de la contacta, para las iniciales de su avatar. */
  customerName?: string | null;
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
  const isTeamView = perspective === "team";
  // Banco de pruebas: quien prueba hace de cliente (a la derecha, oscuro).
  const alignRight = isUser;
  const bubbleClass = isUser
    ? "rounded-br-sm bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
    : "rounded-bl-sm border border-neutral-200 bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100";
  const darkBubble = isUser;
  // Las respuestas largas de Valentina se guardan con "---" entre burbujas.
  // GHL manda este texto fijo, en inglés, cuando la clienta envía algo que no
  // sabe pasar (un sticker, una encuesta, un contacto): no lo escribió ella.
  const unsupported = message.content.trim() === "Message type is currently not supported.";
  const displayContent = unsupported
    ? "Mensaje que no se puede mostrar acá (sticker, contacto u otro formato). Miralo en WhatsApp"
    : message.content.replace(/\n\s*---\s*\n/g, "\n\n");
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

  const time = new Date(message.created_at).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Bandeja real de WhatsApp: mismo layout que el chat de Hábitat. La clienta a
  // la derecha (burbuja oscura, avatar con iniciales); Valentina y el equipo a
  // la izquierda (burbuja clara, avatar de robot dorado o del equipo), con la
  // etiqueta del autor arriba del texto y la hora abajo. El feedback por
  // mensaje va al lado de la hora, solo en los mensajes de Valentina.
  if (isTeamView) {
    const author = isUser ? CUSTOMER_AUTHOR_LABEL : isAgent ? AI_AUTHOR_LABEL : TEAM_AUTHOR_LABEL;
    const teamBubble = isUser
      ? "rounded-br-sm bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
      : "rounded-bl-sm border border-neutral-200 bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100";
    // Mensajes seguidos del mismo autor: sin avatar repetido, con el hueco
    // para que las burbujas queden alineadas.
    const avatar = showAuthor ? (
      <MessageAvatar
        kind={isUser ? "customer" : isAgent ? "ai" : "team"}
        name={isUser ? customerName : null}
      />
    ) : (
      <span aria-hidden className="w-7 shrink-0" />
    );
    return (
      <div
        id={`message-${message.id}`}
        className={`flex items-start gap-2 px-1 py-0.5 ${isUser ? "justify-end" : "justify-start"}`}
      >
        {!isUser && avatar}
        <div className="min-w-0 max-w-[calc(100%_-_2.5rem)] sm:max-w-[78%]">
          <div
            className={`whitespace-pre-wrap break-words rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed ${teamBubble}`}
          >
            {showAuthor && (
              <p
                className={`mb-1 text-[11px] font-medium ${
                  isAgent ? "text-gold-fg dark:text-gold" : "opacity-80"
                }`}
              >
                {author}
              </p>
            )}
            {message.attachment_path && (
              <MessageAttachment path={message.attachment_path} type={message.attachment_type} />
            )}
            {unsupported ? (
              <span className="italic opacity-70">{displayContent}</span>
            ) : (
              displayContent.trim() && renderWithLinks(displayContent, isUser)
            )}
          </div>

          <div
            className={`mt-1 flex flex-wrap items-center gap-2 px-1 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 ${
              isUser ? "justify-end" : "justify-start"
            }`}
          >
            <time dateTime={message.created_at}>{time}</time>
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
            {reactionsCol}
          </div>

          {quickBubble && <div className="mt-2 flex">{quickBubble}</div>}
          {traceOpen && canExpand && message.trace_id && <MessageTrace traceId={message.trace_id} />}
        </div>
        {isUser && avatar}
      </div>
    );
  }

  return (
    <div
      id={`message-${message.id}`}
      className={`flex items-end gap-1 px-1 py-0.5 ${
        alignRight ? "justify-end" : "justify-start"
      }`}
    >
      <div className="min-w-0 max-w-[85%] sm:max-w-[78%]">
        <div
          className={`whitespace-pre-wrap break-words rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed ${bubbleClass}`}
        >
          {message.attachment_path && (
            <MessageAttachment
              path={message.attachment_path}
              type={message.attachment_type}
            />
          )}
          {unsupported ? (
            <span className="italic opacity-70">{displayContent}</span>
          ) : (
            displayContent.trim() && renderWithLinks(displayContent, darkBubble)
          )}
        </div>

        <div
          className={`mt-1 flex items-center gap-2 px-1 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 ${
            alignRight ? "justify-end" : "justify-start"
          }`}
        >
          <span>
            {new Date(message.created_at).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
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
