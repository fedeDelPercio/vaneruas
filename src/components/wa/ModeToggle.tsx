"use client";

import { Bot, Loader2, UserRound } from "lucide-react";

// Quién atiende ESTA conversación: Valentina (IA) o el equipo. Es el mismo
// dato que el tag de pausa de GoHighLevel; el cambio se sincroniza allá.

export type ConversationMode = "AI" | "HUMAN";

const OPTIONS: { value: ConversationMode; label: string; Icon: typeof Bot }[] = [
  { value: "AI", label: "Valentina", Icon: Bot },
  { value: "HUMAN", label: "Equipo", Icon: UserRound },
];

export function ModeToggle({
  mode,
  onChange,
  busy,
}: {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
  busy?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Quién atiende la conversación"
      className="inline-grid shrink-0 grid-cols-2 gap-0.5 rounded-lg border border-neutral-200 bg-neutral-100/60 p-0.5 dark:border-neutral-800 dark:bg-neutral-900/60"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            disabled={busy}
            aria-label={value === "AI" ? "Atiende Valentina" : "Atiende el equipo"}
            title={
              value === "AI"
                ? "Valentina responde esta conversación"
                : "El equipo responde, Valentina queda en pausa"
            }
            onClick={() => {
              if (!selected) onChange(value);
            }}
            className={`flex min-h-[30px] min-w-[36px] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:cursor-wait ${
              selected
                ? value === "HUMAN"
                  ? "bg-white text-warn-fg shadow-sm ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-warn dark:ring-neutral-700"
                  : "bg-white text-neutral-900 shadow-sm ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:ring-neutral-700"
                : "text-neutral-500 enabled:hover:text-neutral-900 dark:text-neutral-400 dark:enabled:hover:text-neutral-100"
            }`}
          >
            {busy && !selected ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Icon className="h-3 w-3" strokeWidth={1.75} />
            )}
            <span className="hidden lg:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
