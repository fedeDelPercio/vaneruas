"use client";

import { useEffect, useState } from "react";

// Hook compartido por los charts: lee la clase `dark` del <html> (el proyecto
// no usa next-themes, el tema es una clase toggleada a mano) y reacciona al
// cambio de tema vía MutationObserver. recharts necesita colores resueltos
// (strings), así que cada chart elige su paleta según este flag.
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
