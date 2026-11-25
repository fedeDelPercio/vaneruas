// ===========================================================================
// Plazos con fecha fija, resueltos en código.
//
// El modelo compara mal fechas. Con "hoy es jueves 26/11" en el contexto y
// "las inscripciones cierran el miércoles 25 a las 23 hs" en la base, igual
// respondía "todavía estás a tiempo, cierran este miércoles" y compartía el
// link de compra. Lo mismo con "la primera tarea del calendario es el lunes
// 9": lo seguía diciendo días después.
//
// Mismo criterio que `followUpTiming` en business-hours.ts: el código decide
// si el corte ya pasó y le pasa al modelo el estado YA RESUELTO, así no tiene
// que razonarlo. Va al orquestador y al evaluator por igual, para que no se
// contradigan.
//
// Para sumar un plazo nuevo: agregalo a PLAZOS. `mostrarHasta` evita que
// queden líneas viejas para siempre en el prompt.
// ===========================================================================

import { EXTENSION_ANTES, EXTENSION_CORTE_ISO, EXTENSION_DESPUES } from "./extension-cupos";

interface Plazo {
  /** Instante del corte, con zona horaria explícita. */
  corte: string;
  /** Qué decirle al modelo mientras el corte no pasó. */
  antes: string;
  /** Qué decirle al modelo desde el corte en adelante. */
  despues: string;
  /** Desde esta fecha la línea deja de inyectarse (ya no aporta). */
  mostrarHasta: string;
}

const PLAZOS: Plazo[] = [
  {
    // Venta normal hasta las 23:00; desde ahí, cupos adicionales (extension-cupos.ts).
    corte: EXTENSION_CORTE_ISO,
    antes: EXTENSION_ANTES,
    despues: EXTENSION_DESPUES,
    mostrarHasta: "2027-01-01T00:00:00-03:00",
  },
  {
    corte: "2026-11-28T21:00:00-03:00",
    antes:
      "Masterclass Peelings de Verano: todavía NO se dictó (es el sábado 28/11 de 16 a 21 hs). El código del calendario todavía no se dio.",
    despues:
      "Masterclass Peelings de Verano: YA SE DICTÓ el sábado 28/11. El código del calendario ya se dio en vivo en la clase. Igual NUNCA lo des vos ni lo inventes.",
    mostrarHasta: "2027-04-01T00:00:00-03:00",
  },
  {
    corte: "2026-11-09T00:00:00-03:00",
    antes:
      'Calendario "Planificá tu verano": la primera tarea es el lunes 9/11 y todavía no llegó, podés mencionarla.',
    despues:
      'Calendario "Planificá tu verano": la primera tarea (lunes 9/11) ya pasó. NO digas que la primera tarea es el lunes 9.',
    mostrarHasta: "2026-12-01T00:00:00-03:00",
  },
];

/** Las líneas de plazo que aplican hoy, ya resueltas. */
export function plazosResueltos(now: Date = new Date()): string[] {
  const t = now.getTime();
  return PLAZOS.filter((p) => t < new Date(p.mostrarHasta).getTime()).map((p) =>
    t >= new Date(p.corte).getTime() ? p.despues : p.antes,
  );
}

/** Bloque listo para el prompt, o "" si no hay plazos vigentes. */
export function plazosBlock(now: Date = new Date()): string {
  const lineas = plazosResueltos(now);
  if (!lineas.length) return "";
  return [
    "=== Plazos (ya calculados contra la fecha de hoy: usalos tal cual, no los recalcules) ===",
    ...lineas.map((l) => `- ${l}`),
  ].join("\n");
}
