"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Toggle de tema claro / oscuro. El tema se persiste en localStorage y se
// aplica antes del paint mediante un script en el layout (sin parpadeo).

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("atp.theme", next ? "dark" : "light");
    } catch {
      // localStorage no disponible: el cambio igual aplica en esta sesión.
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Activar modo claro" : "Activar modo oscuro"}
      title={dark ? "Modo claro" : "Modo oscuro"}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      {/* Hasta montar, se muestra la luna por defecto para no parpadear. */}
      {mounted && dark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}
