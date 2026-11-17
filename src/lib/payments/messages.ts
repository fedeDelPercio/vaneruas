// ===========================================================================
// Textos fijos que Valentina manda en el flujo de comprobantes.
//
// No pasan por el evaluator ni por sanitize: salen tal cual por
// deliverAssistantToWhatsApp, en UNA burbuja (no se parten por "---"). Por
// eso pueden llevar punto, saltos de línea y emojis.
//
// Sin "server-only" a propósito: los importan también los tests de scripts/
// y el importador de mensajes del equipo (que los reconoce como nuestros).
// ===========================================================================

/** Confirmación de comprobante recibido (cuando la imagen sí parece un comprobante). */
export const COMPROBANTE_RECEIVED_MESSAGE =
  "Genial, gracias por compartir el comprobante 🙌 El equipo lo revisa y te confirma la inscripción a la brevedad.\n\n" +
  "⚠️ IMPORTANTE: Ahora revisamos manualmente tu solicitud. No hace falta que vuelvas a escribir, tranquila que no te vas a quedar sin tu lugar, podemos tener muchos mensajes pero no te vamos a dejar sin respuesta ♥️";

/**
 * Versión anterior de la confirmación (hasta el 17/11/2026). Queda para que el
 * importador de mensajes del equipo siga reconociendo los envíos viejos como
 * nuestros.
 */
export const COMPROBANTE_RECEIVED_MESSAGE_LEGACY =
  "Genial, gracias por compartir el comprobante 🙌 El equipo lo revisa y te confirma la inscripción a la brevedad";

/** Acuse neutro cuando la imagen no parece un comprobante. */
export const ATTACHMENT_RECEIVED_MESSAGE =
  "Gracias, ya lo recibimos 🙌 El equipo lo revisa y te confirma a la brevedad";


/**
 * Pedido del correo cuando llega un comprobante y todavía no tenemos a dónde
 * mandarle el acceso. Va en una burbuja aparte, después de la confirmación.
 * También figura en knowledge-base.md (el evaluator no ve el orquestador).
 */
export const EMAIL_REQUEST_MESSAGE =
  "Para darte el acceso, me pasás el correo con el que te inscribiste en la web? 📩";
