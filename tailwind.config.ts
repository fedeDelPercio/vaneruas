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
        // Geist Sans y Geist Mono se inyectan vía next/font en <html>
        // (ver src/app/layout.tsx) como CSS variables y se usan acá.
        sans: ["var(--font-geist-sans)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-geist-mono)", ...defaultTheme.fontFamily.mono],
      },
      colors: {
        // Acentos semánticos del panel. Sobrios, sin fondos saturados.
        // Pensados para usarse principalmente como color de texto o como
        // dot/indicator, no como fondo de bloques grandes.
        ok: {
          DEFAULT: "#10b981",
          fg: "#047857",
          bg: "rgba(16, 185, 129, 0.08)",
        },
        warn: {
          DEFAULT: "#f59e0b",
          fg: "#b45309",
          bg: "rgba(245, 158, 11, 0.08)",
        },
      },
      letterSpacing: {
        // Tracking apretado para títulos y números (refined look).
        "tight-er": "-0.015em",
      },
      boxShadow: {
        // Sombra suave para popovers/dropdowns. Sin glow.
        soft: "0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)",
        "soft-dark":
          "0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px rgba(0, 0, 0, 0.4)",
      },
    },
  },
  plugins: [],
};

export default config;
