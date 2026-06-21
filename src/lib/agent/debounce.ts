// ===========================================================================
// Acumulación de mensajes (debounce) para WhatsApp — lógica pura.
//
// Las personas mandan varios mensajes seguidos. En vez de responder cada uno,
// esperamos un período de silencio y consolidamos. Esta función decide, dado
// el estado actual de la conversación, qué hacer con el job que se está
// procesando:
//   - "answer": ya hubo silencio suficiente → responder el turno consolidado.
//   - "defer":  llegó un mensaje dentro de la ventana → re-diferir el job.
//   - "skip":   no hay mensajes sin responder (job superado por otro del burst).
//
// Es pura (sin DB, sin reloj global): recibe los mensajes y `nowMs`, así se
// puede testear de forma determinística. El worker (jobs/process) la usa.
// ===========================================================================

export interface TurnMessage {
  id: string;
  role: string;
  content: string | null;
  created_at: string;
  attachment_path: string | null;
}

export type TurnDecision =
  | {
      action: "answer";
      userMessage: string;
      anchorMessageId: string;
      turnMessageIds: string[];
    }
  | { action: "defer"; processAfter: string }
  | { action: "skip" };

/**
 * Resuelve el turno a responder para una conversación de WhatsApp.
 *
 * @param allMsgs  Mensajes de la conversación, ordenados por created_at asc.
 * @param debounceSeconds  Ventana de silencio.
 * @param nowMs  Momento actual (epoch ms). Inyectable para tests.
 */
export function resolveWhatsAppTurn(
  allMsgs: TurnMessage[],
  debounceSeconds: number,
  nowMs: number,
): TurnDecision {
  // Run final de mensajes 'user' sin responder: todo lo que viene después del
  // último mensaje que NO es del usuario (assistant / system / human).
  let lastNonUserIdx = -1;
  for (let i = allMsgs.length - 1; i >= 0; i--) {
    if (allMsgs[i]!.role !== "user") {
      lastNonUserIdx = i;
      break;
    }
  }
  const trailing = allMsgs.slice(lastNonUserIdx + 1);

  // Nada sin responder: el turno ya se contestó (job hermano superado por otro).
  if (trailing.length === 0) return { action: "skip" };

  // Ventana de silencio: si el último mensaje llegó hace menos del debounce,
  // todavía está acumulando → re-diferir hasta `último + ventana`.
  const latestAt = new Date(trailing[trailing.length - 1]!.created_at).getTime();
  if (nowMs - latestAt < debounceSeconds * 1000) {
    return {
      action: "defer",
      processAfter: new Date(latestAt + debounceSeconds * 1000).toISOString(),
    };
  }

  // Consolidar el texto de los mensajes acumulados. Excluye adjuntos
  // (comprobantes): esos los procesa su propio job de captura de pago.
  const textParts = trailing
    .filter((m) => !m.attachment_path)
    .map((m) => m.content?.trim())
    .filter((c): c is string => Boolean(c));

  // Solo adjuntos en el run (sin texto): los maneja el flujo de comprobante.
  if (textParts.length === 0) return { action: "skip" };

  return {
    action: "answer",
    userMessage: textParts.join("\n"),
    anchorMessageId: trailing[trailing.length - 1]!.id,
    turnMessageIds: trailing.map((m) => m.id),
  };
}
