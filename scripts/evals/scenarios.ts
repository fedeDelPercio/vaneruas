// ===========================================================================
// Escenarios de eval del agente — Template.
//
// Cada escenario es una conversación multi-turno. El historial y la categoría
// de derivación se acumulan entre turnos (igual que en producción). Las
// expectativas (`expect`) se chequean contra lo que vería el cliente.
//
// El template viene SIN escenarios cargados: agregalos a medida que vayas
// descubriendo bugs o casos críticos del flow del cliente. La idea: cada
// vez que el agente falle en un caso, sumá el escenario acá para que no
// regrese.
//
// Patrón: nombre claro, un `now` ISO con offset, turnos del lead y lo que
// esperás que el agente haga. Ver los matchers disponibles en `assert.ts`.
//
// Correlo con: `npm run eval` (todos) o `npm run eval -- "texto"` (filtro
// por nombre).
// ===========================================================================

import type { Expect } from "./assert";

export interface Turn {
  user: string;
  expect?: Expect;
}

export interface Scenario {
  name: string;
  /** ISO con offset, ej: "2026-06-01T10:00:00-03:00". Fija el contexto de horario. */
  now: string;
  isExistingCustomer?: boolean;
  turns: Turn[];
}

export const SCENARIOS: Scenario[] = [
  // TODO: sumar escenarios. Ejemplo mínimo de un saludo seco:
  //
  // {
  //   name: "Saludo seco: abre cordial y no escala",
  //   now: "2026-06-01T10:00:00-03:00",
  //   turns: [
  //     {
  //       user: "hola",
  //       expect: {
  //         doesNotNotify: true,
  //         contains: ["asistente"],
  //       },
  //     },
  //   ],
  // },
];
