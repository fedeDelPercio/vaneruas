"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Estado del buscador de una bandeja. Arranca con lo que venga en ?q= (así la
// ficha del chat puede mandar a "Aprobaciones" ya filtrado por una persona) y
// entrega también una versión con demora, para no pedir la lista en cada tecla.
//
// El ?q= se lee con useSearchParams y no con window.location: al llegar por un
// link interno, en el primer render window.location todavía tiene la URL
// anterior y la bandeja abría sin filtrar.

export function useContactSearch(delayMs = 250): {
  query: string;
  setQuery: (value: string) => void;
  /** Lo que hay que usar para buscar (query con demora, sin espacios al borde). */
  activeQuery: string;
} {
  const urlQuery = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [activeQuery, setActiveQuery] = useState(urlQuery.trim());

  // Si cambia el ?q= de la URL (otro link hacia la misma bandeja), manda la URL.
  useEffect(() => {
    setQuery(urlQuery);
    setActiveQuery(urlQuery.trim());
  }, [urlQuery]);

  useEffect(() => {
    const t = setTimeout(() => setActiveQuery(query.trim()), delayMs);
    return () => clearTimeout(t);
  }, [query, delayMs]);

  return { query, setQuery, activeQuery };
}
