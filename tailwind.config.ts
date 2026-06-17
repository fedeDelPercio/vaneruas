import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

// Tailwind 3.4 (no 4). Dark mode por clase: la app togglea la clase `dark`
// en <html> respetando prefers-color-scheme y la elección del usuario.
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Poppins (marca Vanesa Rúas) como sans; Geist Mono solo para datos
        // tabulares. Se inyectan vía next/font en <html> (ver layout.tsx).
        sans: ["var(--font-poppins)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-geist-mono)", ...defaultTheme.fontFamily.mono],
      },
      colors: {
        // Dorado: el acento premium de la marca. `gold` como sólido (bordes,
        // texto en light, dots); el gradiente vive en utilidades de globals.css.
        gold: {
          DEFAULT: "#f9a900",
          start: "#ffff7f",
          end: "#f9a900",
          fg: "#b45309", // dorado oscuro legible sobre fondo claro
        },
        // Acentos semánticos (alineados al design-system: success/warning/error/info).
        ok: {
          DEFAULT: "#22c55e",
          fg: "#15803d",
          bg: "rgba(34, 197, 94, 0.12)",
        },
        warn: {
          DEFAULT: "#f59e0b",
          fg: "#b45309",
          bg: "rgba(245, 158, 11, 0.12)",
        },
      },
      letterSpacing: {
        // Tracking apretado para títulos y números.
        "tight-er": "-0.015em",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)",
        "soft-dark":
          "0 1px 3px rgba(0, 0, 0, 0.5), 0 20px 60px rgba(0, 0, 0, 0.6)",
        // Glow dorado de marca (para bordes/cards destacadas, hover de CTA).
        gold: "0 0 20px rgba(249, 169, 0, 0.35), 0 0 40px rgba(249, 169, 0, 0.12)",
        "gold-sm": "0 0 0 3px rgba(249, 169, 0, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
