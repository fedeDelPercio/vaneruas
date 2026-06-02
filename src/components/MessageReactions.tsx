"use client";

import { MessageSquarePlus } from "lucide-react";

// Botón único inline que renderiza al costado de cada MessageBubble del
// asistente. Al hacer click abre la QuickCommentBubble con un selector de
// sentimiento (positivo / neutro / negativo) y un textarea opcional.
// Si el mensaje ya tiene reacciones del equipo, mostramos el conteo total
// como dot indicator sutil.

export type MessageReactionState = {
  positiveCount: number;
  negativeCount: number;
  noteCount: number;
  myKind: "positive" | "negative" | null;
};

export const EMPTY_REACTION: MessageReactionState = {
  positiveCount: 0,
  negativeCount: 0,
  noteCount: 0,
  myKind: null,
};

export function MessageReactions({
  state,
  onOpen,
}: {
  state: MessageReactionState;
  onOpen: () => void;
}) {
  const total = state.positiveCount + state.negativeCount + state.noteCount;
  const hasReactions = total > 0;
  // Si el mensaje tiene reacciones, el botón queda más visible para invitar
  // a leerlas. Si no, queda muy sutil hasta el hover.
  const opacityClass = hasReactions
    ? "opacity-70 hover:opacity-100"
    : "opacity-40 hover:opacity-100";
  return (
    <div className={`flex shrink-0 flex-row items-center self-end pb-1 transition ${opacityClass}`}>
      <button
        onClick={onOpen}
        title="Dejar una reacción o comentario"
        aria-label="Dejar una reacción o comentario"
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-neutral-400 transition hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {hasReactions && (
          <span className="font-mono text-[10px] leading-none">{total}</span>
        )}
      </button>
    </div>
  );
}
