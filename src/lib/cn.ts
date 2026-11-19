// Une clases condicionales (subset de clsx). Sin tailwind-merge: los
// componentes que la usan no pisan utilidades entre sí.
type ClassValue = string | false | null | undefined | Record<string, boolean | undefined>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (typeof v === "string") out.push(v);
    else for (const [k, on] of Object.entries(v)) if (on) out.push(k);
  }
  return out.join(" ");
}
