// ===========================================================================
// Cuándo se le pide el correo a la contacta (lógica pura, sin I/O).
//
// Regla (actualizada el 22/11/2026): si falta el correo se pide UNA vez, al
// recibir el comprobante y en la MISMA burbuja de la confirmación. Si hace
// falta el título, primero el título: el pedido va en el mensaje de título
// validado. Pedirlo solo al aprobar (regla del 18/11) fallaba porque la
// aprobación suele llegar con la ventana de 24 h de WhatsApp cerrada y ese
// mensaje no se entrega. Se apaga con EMAIL_ASK_ON_RECEIPT=false, y vuelve a
// pedirse solo al aprobar.
//
// Un pedido que no llegó a WhatsApp no cuenta como pedido.
//
// Los disparadores (comprobante, título, PATCH /api/payments/[id]) usan estas
// funciones para elegir UN solo mensaje coherente. El contexto del agente
// (run.ts) usa `emailAskState`.
//
// Sin "server-only": lo usan los tests de scripts/.
// ===========================================================================

import { findIncompleteEmail } from "../contact-email";
import {
  COMPROBANTE_RECEIVED_ASK_EMAIL_MESSAGE,
  COMPROBANTE_RECEIVED_MESSAGE,
  EMAIL_ASK_MESSAGES,
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
  PAYMENT_APPROVED_MESSAGE,
  TITLE_VALIDATED_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_COMPROBANTE_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_COMPROBANTE_MESSAGE,
  TITLE_VALIDATED_PAYMENT_OK_MESSAGE,
} from "./messages";

const FLAG_OFF_VALUES = ["false", "0", "off", "no"];

/** Flag EMAIL_ASK_ON_RECEIPT, leído en runtime. Default: prendido. */
export function emailAskOnReceiptEnabled(
  raw: string | undefined | null = process.env.EMAIL_ASK_ON_RECEIPT,
): boolean {
  return !FLAG_OFF_VALUES.includes((raw ?? "").trim().toLowerCase());
}

/** ¿Este mensaje de Valentina ya le pidió el correo? */
export function isEmailAsk(content: string | null | undefined): boolean {
  const c = (content ?? "").trim();
  return EMAIL_ASK_MESSAGES.some((m) => m === c);
}

// Pedido redactado por el agente (texto libre): verbo de pedido + "correo".
// "te enviamos el acceso a tu correo" NO matchea.
const FREE_TEXT_ASK_RE =
  /(?<!\p{L})(?:pas[aá]s|p[aá]same|mand[aá]s|m[aá]ndame|compart[ií]s|compart[ií]me|dej[aá]s|d[eé]jame|envi[aá]s|envi[aá]me|reenvi[aá]s|reenvi[aá]me|escrib[ií]s|escrib[ií]me|necesito|indic[aá]s|confirm[aá]s)\s+(?:[\p{L}\p{N}]+\s+){0,4}(?:correo|e-?mail|mail)(?!\p{L})/iu;

/** ¿Este mensaje pide el correo, sea texto fijo o redactado por el agente? */
export function looksLikeEmailAsk(content: string | null | undefined): boolean {
  return isEmailAsk(content) || FREE_TEXT_ASK_RE.test(content ?? "");
}

export interface AssistantDeliveryRow {
  content?: string | null;
  external_id: string | null;
  delivered_at: string | null;
  /** Cuándo se guardó. Un pedido de hace segundos puede estar saliendo todavía. */
  created_at?: string | null;
}

/**
 * Un pedido recién guardado (menos de 2 min) cuenta como hecho aunque todavía
 * no tenga id de GHL: el envío puede estar en curso. Evita que otro job del
 * mismo tirón (texto + foto) lo vuelva a pedir.
 */
export const EMAIL_ASK_IN_FLIGHT_MS = 2 * 60_000;

/**
 * ¿El mensaje llegó a la persona? `messages` no guarda el fallo: en WhatsApp
 * la prueba es el id de GHL o `delivered_at`. Sin ninguno, falló o se omitió
 * (modo humano, allowlist). En el panel de prueba llega por Realtime.
 */
export function wasDelivered(row: AssistantDeliveryRow, source: string | null | undefined): boolean {
  if (source !== "whatsapp") return true;
  return Boolean(row.external_id || row.delivered_at);
}

/** ¿Alguno de estos mensajes del asistente es un pedido de correo entregado? */
export function hasDeliveredEmailAsk(
  rows: readonly AssistantDeliveryRow[],
  source: string | null | undefined,
  now: number = Date.now(),
): boolean {
  return rows.some((r) => {
    if (!looksLikeEmailAsk(r.content)) return false;
    if (wasDelivered(r, source)) return true;
    const at = r.created_at ? Date.parse(r.created_at) : NaN;
    return Number.isFinite(at) && now - at < EMAIL_ASK_IN_FLIGHT_MS;
  });
}

/**
 * Confirmación de comprobante. Pide el correo en la misma burbuja si falta,
 * no se pidió en este período y el flag está prendido.
 */
export function receiptMessage(args: {
  hasEmail: boolean;
  alreadyAsked: boolean;
  askOnReceipt: boolean;
}): { content: string; asksEmail: boolean } {
  if (args.askOnReceipt && !args.hasEmail && !args.alreadyAsked) {
    return { content: COMPROBANTE_RECEIVED_ASK_EMAIL_MESSAGE, asksEmail: true };
  }
  return { content: COMPROBANTE_RECEIVED_MESSAGE, asksEmail: false };
}

/** Título validado con un comprobante todavía en revisión. */
export function titleWithComprobanteMessage(args: {
  hasEmail: boolean;
  alreadyAsked: boolean;
  askOnReceipt: boolean;
}): string {
  return args.askOnReceipt && !args.hasEmail && !args.alreadyAsked
    ? TITLE_VALIDATED_COMPROBANTE_ASK_EMAIL_MESSAGE
    : TITLE_VALIDATED_COMPROBANTE_MESSAGE;
}

/**
 * Mensaje al aprobar un pago. Con correo, o si ya se lo pedimos por este pago
 * (idempotencia: nunca dos pedidos por el mismo pago), la confirmación de
 * siempre; sin correo, la confirmación que pide el correo en el mismo mensaje.
 */
export function approvalMessage(args: { hasEmail: boolean; alreadyAsked: boolean }): {
  content: string;
  asksEmail: boolean;
} {
  if (!args.hasEmail && !args.alreadyAsked) {
    return { content: PAYMENT_APPROVED_ASK_EMAIL_MESSAGE, asksEmail: true };
  }
  return { content: PAYMENT_APPROVED_MESSAGE, asksEmail: false };
}

/**
 * Mensaje al validarse el título cuando ya había un pago verificado (camino
 * "aprobación forzada, el título llega después"). null = usar el mensaje de
 * siempre de handle.ts (no hay pago verificado todavía).
 */
export function titleValidatedMessage(args: {
  paymentValidated: boolean;
  hasEmail: boolean;
  alreadyAsked: boolean;
}): string | null {
  if (!args.paymentValidated) return null;
  if (!args.hasEmail && !args.alreadyAsked) return TITLE_VALIDATED_ASK_EMAIL_MESSAGE;
  return TITLE_VALIDATED_PAYMENT_OK_MESSAGE;
}

/** Estado del correo para el contexto del agente, ya resuelto en código. */
export type EmailAskState =
  /** No hay comprobantes: no se dice nada (el orquestador ya sabe aceptar un correo). */
  | "sin_pagos"
  /** Ya tenemos un correo válido. */
  | "ya_tenemos"
  /** Pago verificado (y título OK) sin correo: se puede pedir. */
  | "pedir"
  /** Comprobante en revisión, sin correo y sin pedido entregado: pedirlo en esta respuesta. */
  | "pedir_en_revision"
  /** Ya se le pidió (y le llegó) en este período: no insistir. */
  | "ya_pedido"
  /** Falta el título, o no hay nada en revisión: NO pedirlo todavía. */
  | "todavia_no";

export function emailAskState(args: {
  hasEmail: boolean;
  /** Algún comprobante registrado en la conversación. */
  hasPayment: boolean;
  /** Algún pago `validated` sin retención por título. */
  hasApprovedPayment: boolean;
  /** Algún comprobante pendiente, sin retención por título. */
  hasPaymentInReview?: boolean;
  /** Algún comprobante retenido esperando el título (primero el título). */
  awaitingTitle?: boolean;
  /** Ya hay un pedido ENTREGADO en el período de pago actual. */
  alreadyAsked?: boolean;
  /** Flag EMAIL_ASK_ON_RECEIPT. Apagado: solo se pide con el pago aprobado. */
  askOnReceipt?: boolean;
}): EmailAskState {
  if (!args.hasPayment) return "sin_pagos";
  if (args.hasEmail) return "ya_tenemos";
  if (!args.askOnReceipt) return args.hasApprovedPayment ? "pedir" : "todavia_no";
  if (args.hasApprovedPayment) return args.alreadyAsked ? "ya_pedido" : "pedir";
  if (args.awaitingTitle || !args.hasPaymentInReview) return "todavia_no";
  return args.alreadyAsked ? "ya_pedido" : "pedir_en_revision";
}

/** Línea que ve el agente (orquestador y evaluator). "" = nada que decir. */
export function emailContextLine(state: EmailAskState): string {
  switch (state) {
    case "sin_pagos":
      return "";
    case "ya_tenemos":
      return "Pedir correo: NO. Ya tenemos su correo para el acceso, no se lo pidas de nuevo. Si dice que tiene dos correos o te da otro distinto, el acceso le llega al correo que cargó en la web al inscribirse: no le ofrezcas cambiarlo ni le prometas que le llega al otro (solo si pide cambiarlo, derivá).";
    case "pedir":
      return "Pedir correo: SÍ. Su pago ya está verificado y todavía no tenemos su correo: si no lo dio, pedile (una sola vez) el correo con el que se inscribió en la web.";
    case "pedir_en_revision":
      return "Pedir correo: SÍ, en esta respuesta. Su comprobante está en revisión y todavía no tenemos su correo: respondé lo que te preguntó y, en el mismo mensaje, pedile una sola vez el correo con el que se inscribió en la web, así le mandamos el acceso apenas se confirme. No digas que el pago está aprobado.";
    case "ya_pedido":
      return "Pedir correo: NO, ya se lo pedimos y todavía no lo pasó. No insistas. Solo si pregunta por el acceso, recordale que nos falta el correo con el que se inscribió en la web. Si te lo comparte, agradecele y confirmale que queda registrado.";
    case "todavia_no":
      return "Pedir correo: NO todavía. Falta aprobar su título o su comprobante: no le pidas el correo ahora. Si te lo comparte igual, agradecele y confirmale que queda registrado.";
  }
}

/** Línea para un correo incompleto. Recibe la forma ya enmascarada. */
export function incompleteEmailContextLine(masked: string): string {
  return `Pedir correo: Escribió un correo incompleto (forma enmascarada ${masked}): pedile que lo reenvíe completo, una sola vez. No lo des por registrado ni lo completes vos.`;
}

/**
 * ¿Hay un correo incompleto sin resolver? Mira el turno y después el historial
 * (del más nuevo al más viejo) hasta el último pedido entregado: si ya se lo
 * pedimos después de que lo escribió, no se repite. Devuelve la forma
 * enmascarada o null.
 */
export function pendingIncompleteEmail(args: {
  turnMessage: string | null | undefined;
  /** Del más nuevo al más viejo. */
  history: readonly (AssistantDeliveryRow & { role: string })[];
  source: string | null | undefined;
}): string | null {
  const inTurn = findIncompleteEmail(args.turnMessage);
  if (inTurn) return inTurn;
  for (const m of args.history) {
    if (m.role === "assistant" && looksLikeEmailAsk(m.content) && wasDelivered(m, args.source)) return null;
    if (m.role === "user") {
      const hit = findIncompleteEmail(m.content);
      if (hit) return hit;
    }
  }
  return null;
}
