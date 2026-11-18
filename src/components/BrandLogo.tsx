import Image from "next/image";

// Logo de Vanesa Rúas Formación Profesional (override de esta branch del
// BrandLogo del template, ver CLAUDE.md "Logo de cliente").
//
// El PNG (public/brand/vanesa-ruas.png, 785x462) es negro sobre transparente:
// en dark se invierte a blanco con `dark:invert`, como el logo de Hábitat. Así
// hay un solo archivo para los dos temas.
//
// Tamaños (relación 1,7: casi cuadrado, con "Vanesa Rúas" en cursiva y
// "FORMACIÓN PROFESIONAL" abajo):
//   - "sidebar": cabecera del menú expandido (58 px de alto, ~99 px de ancho).
//   - "topbar": barra superior en celular (h-9).
//   - "compact": menú contraído (64 px de ancho). El logo entero ahí no se
//     lee, así que va un monograma "VR" con el acento dorado.

export function BrandLogo({ variant = "sidebar" }: { variant?: "sidebar" | "topbar" | "compact" }) {
  if (variant === "compact") {
    return (
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/40 bg-gold/[0.06] text-[13px] font-medium italic tracking-tight-er text-gold-fg dark:text-gold"
      >
        VR
      </span>
    );
  }
  return (
    <Image
      src="/brand/vanesa-ruas.png"
      alt="Vanesa Rúas Formación Profesional"
      width={785}
      height={462}
      priority
      className={`w-auto dark:invert ${variant === "topbar" ? "h-9" : "h-[58px]"}`}
    />
  );
}
