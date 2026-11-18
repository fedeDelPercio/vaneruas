import { Bot, UserRound } from "lucide-react";

// Avatar de autor de un mensaje, portado de Hábitat (MessageAvatar.tsx).
// Diferencia de marca: donde Hábitat usa su verde para la IA, acá va el dorado
// de Vanesa Rúas. El equipo, que en Hábitat es ámbar, acá es neutro sólido
// para no confundirse con el dorado de la IA.

const TONES = {
  customer:
    "border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300",
  ai: "border-gold/40 bg-gold/10 text-gold-fg dark:border-gold/30 dark:bg-gold/10 dark:text-gold",
  team: "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-200 dark:bg-neutral-100 dark:text-neutral-900",
} as const;

export type MessageAvatarKind = keyof typeof TONES;

/** Etiqueta del autor: la misma que se ve arriba del texto de la burbuja. */
export const AI_AUTHOR_LABEL = "Valentina · IA";
export const TEAM_AUTHOR_LABEL = "Equipo";
export const CUSTOMER_AUTHOR_LABEL = "Cliente";

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return ((words[0]?.charAt(0) ?? "") + (words[1]?.charAt(0) ?? "")).toUpperCase();
  return (words[0] ?? "").slice(0, 2).toUpperCase();
}

export function MessageAvatar({ kind, name }: { kind: MessageAvatarKind; name?: string | null }) {
  const clean = name?.trim() ?? "";
  // Un nombre sin letras (un teléfono como nombre) no da iniciales útiles.
  const hasLetters = /\p{L}/u.test(clean);
  const label =
    kind === "ai" ? AI_AUTHOR_LABEL : kind === "team" ? clean || TEAM_AUTHOR_LABEL : clean || CUSTOMER_AUTHOR_LABEL;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[10px] font-medium tracking-tight-er ${TONES[kind]}`}
    >
      {kind === "ai" ? (
        <Bot aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : hasLetters ? (
        initialsOf(clean)
      ) : (
        <UserRound aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
    </span>
  );
}
