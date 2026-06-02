// Avatar con iniciales sobre un fondo monocromático sutil. La distinción entre
// avatares la dan las iniciales y la tipografía (Geist), no el color.
// Filosofía: refined, sin paleta saturada por nombre.

const SIZES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-[11px]",
  lg: "h-11 w-11 text-[13px]",
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  if (!first) return "?";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + (words[1] ?? "").charAt(0)).toUpperCase();
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border border-neutral-200/70 bg-neutral-100 font-medium tracking-tight-er text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 ${SIZES[size]}`}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
