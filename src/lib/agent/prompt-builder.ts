import type {
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

import { timeContextBlock, type TimeContext } from "./business-hours";
import type { HistoryMessage } from "./types";

// ===========================================================================
// Armado del prompt del orquestador (sin side-effects ni server-only).
//
// Vive separado de orchestrator.ts a propósito: orchestrator.ts importa
// `server-only` y el cliente de Supabase, lo que impide reusarlo desde un
// script de evals. Estas funciones son PURAS (string in, string out) y
// reciben los prompts como parámetros (inyección), así el orquestador de
// producción y el harness de evals comparten EXACTAMENTE el mismo armado
// sin duplicar lógica. Single source of truth.
// ===========================================================================

/**
 * System prompt como array de blocks para habilitar prompt caching de Anthropic.
 *
 * El bloque grande (orquestador + KB) es prácticamente constante entre turnos y
 * entre conversaciones del mismo cliente: lo marcamos como `cache_control:
 * ephemeral` para que Anthropic lo guarde 5 minutos. Los re-hits cobran ~10%
 * del costo de input por esos tokens.
 *
 * El segundo bloque (timeContext + actividad + estado del contacto) cambia por
 * turno y se manda sin cache. Es chico (~10 líneas) así que su costo es bajo.
 */
export function buildSystemPrompt(params: {
  orchestratorPrompt: string;
  knowledgeBase: string;
  timeContext: TimeContext;
  customerMessageCount: number;
  isExistingCustomer: boolean;
  priorEscalation: string | null;
  // Catálogo de eventos en vivo (tabla `events`), inyectado en tiempo de
  // request. Opcional: el harness de evals lo omite. Se concatena a la KB
  // dentro del bloque cacheable porque es estable entre conversaciones del
  // mismo cliente en una misma ventana de tiempo.
  eventsBlock?: string;
  // Pagos que el contacto envió en ESTA conversación (montos), para que el
  // agente pueda matchear el monto con el precio de un evento vigente y deducir
  // a cuál corresponde la consulta. Cambia por conversación → va sin cache.
  paymentContext?: string;
}): TextBlockParam[] {
  const cacheableBlock = [
    params.orchestratorPrompt,
    "# BASE DE CONOCIMIENTO",
    params.knowledgeBase,
    params.eventsBlock?.trim() ? params.eventsBlock.trim() : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const dynamicBlock = [
    timeContextBlock(params.timeContext),
    `# Actividad del cliente\n\nEl cliente envió ${params.customerMessageCount} mensaje(s) en esta ` +
      `conversación (contando el actual). Usalo como contexto de cuán avanzada viene la charla.`,
    customerContextBlock(params.isExistingCustomer),
    paymentContextBlock(params.paymentContext),
    escalationContextBlock(params.priorEscalation),
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { type: "text", text: cacheableBlock, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicBlock },
  ];
}

/**
 * Bloque que le avisa al orquestador si esta conversación YA fue derivada al
 * equipo en un turno anterior. Las notificaciones son internas (no están en
 * el historial de mensajes), así que sin esto el modelo no sabe que ya
 * derivó y vuelve a hacerlo en cada turno, repitiendo "Santino te va a
 * llamar" ante un simple "gracias".
 */
function escalationContextBlock(priorEscalation: string | null): string {
  if (!priorEscalation) return "";
  return [
    "=== Estado de derivación ===",
    `Esta conversación YA fue derivada al equipo (categoría: ${priorEscalation}).`,
    "El equipo ya fue notificado y ya le avisaste al cliente que lo van a",
    "contactar en un mensaje anterior. Por lo tanto, en este turno:",
    "- NO vuelvas a llamar `notify_team` por la MISMA razón. Ya está hecho.",
    "- NO repitas que el equipo se va a contactar. Ya se lo dijiste, repetirlo",
    "  cansa.",
    "- Si el cliente agradece o se despide ('gracias', 'genial', 'perfecto'),",
    "  cerrá cordial y humano SIN derivar ni mencionar la llamada otra vez",
    "  (ej. 'Gracias a vos, cualquier cosa quedamos en contacto').",
    "- Si pregunta algo que la KB cubre, respondelo normal.",
    "- Solo si surge una consulta GENUINAMENTE nueva que no sabés responder,",
    "  podés llamar `notify_team` con la categoría que corresponda, pero",
    "  igual SIN repetir el compromiso de llamada.",
  ].join("\n");
}

/**
 * Bloque con los pagos enviados en esta conversación. Le sirve al agente para
 * deducir a qué evento se refiere una consulta de detalle (matcheando el monto
 * transferido con el precio de un evento vigente). Vacío si no hubo pagos.
 */
function paymentContextBlock(paymentContext?: string): string {
  if (!paymentContext?.trim()) return "";
  return ["=== Pagos de esta conversación ===", paymentContext.trim()].join("\n");
}

/** Bloque con info de si el contacto ya es clienta (pagó o acreditó título). */
function customerContextBlock(isExisting: boolean): string {
  if (isExisting) {
    return [
      "=== Estado del contacto ===",
      "Esta persona YA ES CLIENTA (ya pagó o acreditó su título). Tratala con",
      "calidez como alguien conocido y seguí ayudándola normalmente. NO la",
      "derives al equipo solo por ser clienta: la atención es autogestionada.",
      "Si comparte su correo tras validarse el pago, agradecele y confirmale",
      "que queda registrado para el acceso. Derivá solo si surge un disparador",
      "real (queja, pedido expreso de hablar con una persona, o consulta que la",
      "base de conocimiento no cubre).",
    ].join("\n");
  }
  return [
    "=== Estado del contacto ===",
    "El contacto todavía no es clienta ni está agendada en nuestra base.",
    "Atendela normalmente según el procedimiento del orquestador. Si todavía no",
    "lo hiciste en esta conversación, pedile su nombre y apellido aclarando que",
    "es para agendarla en nuestra base (una sola vez, sin trabar su consulta).",
  ].join("\n");
}

// Algunos mensajes del cliente no tienen texto: por ejemplo cuando manda
// solo la imagen de un comprobante de pago (content vacío). La API de Anthropic
// rechaza mensajes de usuario con contenido vacío, así que los representamos con
// un placeholder que además le da contexto al agente de lo que pasó.
const EMPTY_USER_PLACEHOLDER =
  "[El cliente envió un comprobante de pago, ya registrado para validación]";

function userContent(raw: string): string {
  return raw.trim() ? raw : EMPTY_USER_PLACEHOLDER;
}

/** Mapea el historial de la conversación a mensajes API-compatibles. */
export function buildMessages(params: {
  userMessage: string;
  history: HistoryMessage[];
  evaluatorFeedback: string | null;
}): MessageParam[] {
  const messages: MessageParam[] = [];

  for (const m of params.history) {
    if (m.role === "user") {
      messages.push({ role: "user", content: userContent(m.content) });
    } else if (m.role === "assistant") {
      // Las burbujas del asistente nunca deberían venir vacías, pero si pasa
      // (segmento en blanco) las saltamos para no romper la API.
      if (m.content.trim()) messages.push({ role: "assistant", content: m.content });
    } else if (m.role === "human") {
      // Mensaje de un asesor humano (ya tomó la conversación). Lo serializamos
      // como user para mantener el orden temporal del chat.
      messages.push({
        role: "user",
        content: `[Mensaje del asesor humano del equipo]\n${m.content}`,
      });
    }
    // role === "system": carteles del propio panel (ej: notificaciones). No
    // los pasamos para no confundir al modelo.
  }

  // Mensaje actual del cliente, con el feedback del evaluator si corresponde.
  const lines: string[] = [userContent(params.userMessage)];
  if (params.evaluatorFeedback) {
    lines.push("");
    lines.push("=== Corrección requerida ===");
    lines.push(
      "Tu respuesta anterior NO pasó la validación interna. Generala de nuevo " +
        "corrigiendo esto:",
    );
    lines.push(params.evaluatorFeedback);
  }
  messages.push({ role: "user", content: lines.join("\n") });

  return messages;
}
