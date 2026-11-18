// ===========================================================================
// Cuándo se le pide el correo a la contacta (lógica pura, sin I/O).
//
// Regla (Federico, 18/11/2026): Valentina pide el correo SOLO cuando ya está
// todo aprobado, es decir, el pago quedó verificado y el título (si el gate
// aplicaba) también. Antes se pedía al recibir el comprobante, en una burbuja
// aparte, y se leía como dos mensajes inconexos ("esperando el título" y
// "pasame tu correo").
//
// Los disparadores (PATCH /api/payments/[id] y la validación del título) usan
// estas funciones para elegir UN solo mensaje coherente. El contexto del
// agente (run.ts) usa `emailAskState` para que el modelo no lo pida antes.
//
// Sin "server-only": lo usan los tests de scripts/.
// ===========================================================================

import {
  EMAIL_ASK_MESSAGES,
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
  PAYMENT_APPROVED_MESSAGE,
  TITLE_VALIDATED_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_PAYMENT_OK_MESSAGE,
} from "./messages";

/** ¿Este mensaje de Valentina ya le pidió el correo? */
export function isEmailAsk(content: string | null | undefined): boolean {
  const c = (content ?? "").trim();
  return EMAIL_ASK_MESSAGES.some((m) => m === c);
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
  /** Hay comprobante pero falta aprobar el pago o el título: NO pedirlo todavía. */
  | "todavia_no";

export function emailAskState(args: {
  hasEmail: boolean;
  /** Algún comprobante registrado en la conversación. */
  hasPayment: boolean;
  /** Algún pago `validated` sin retención por título. */
  hasApprovedPayment: boolean;
}): EmailAskState {
  if (!args.hasPayment) return "sin_pagos";
  if (args.hasEmail) return "ya_tenemos";
  return args.hasApprovedPayment ? "pedir" : "todavia_no";
}

/** Línea que ve el agente (orquestador y evaluator). "" = nada que decir. */
export function emailContextLine(state: EmailAskState): string {
  switch (state) {
    case "sin_pagos":
      return "";
    case "ya_tenemos":
      return "Pedir correo: NO. Ya tenemos su correo para el acceso, no se lo pidas de nuevo.";
    case "pedir":
      return "Pedir correo: SÍ. Su pago ya está verificado y todavía no tenemos su correo: si no lo dio, pedile (una sola vez) el correo con el que se inscribió en la web.";
    case "todavia_no":
      return "Pedir correo: NO todavía. Su pago (o su título) todavía no está aprobado: no le pidas el correo ahora, se le pide cuando quede todo aprobado. Si te lo comparte igual, agradecele y confirmale que queda registrado.";
  }
}
