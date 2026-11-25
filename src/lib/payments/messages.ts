import { WHATSAPP_TEMPLATE_BODIES } from "../whatsapp-template-bodies";

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

/**
 * Confirmación de comprobante cuando todavía NO tenemos su correo: lo pide en
 * la MISMA burbuja. El pedido va acá porque la aprobación suele llegar con la
 * ventana de 24 h de WhatsApp ya cerrada y ese mensaje no se entrega. El aviso
 * final cambia a "Después de eso no hace falta...": con el texto de siempre le
 * pediríamos el correo y enseguida le diríamos que no hace falta escribir.
 */
export const COMPROBANTE_RECEIVED_ASK_EMAIL_MESSAGE =
  "Genial, gracias por compartir el comprobante 🙌 El equipo lo revisa y te confirma la inscripción a la brevedad.\n\n" +
  "Mientras tanto, me pasás el correo con el que te inscribiste en la web? Así te mandamos el acceso apenas se confirme 📩\n\n" +
  "⚠️ IMPORTANTE: Ahora revisamos manualmente tu solicitud. Después de eso no hace falta que vuelvas a escribir, tranquila que no te vas a quedar sin tu lugar, podemos tener muchos mensajes pero no te vamos a dejar sin respuesta ♥️";

/** Acuse neutro cuando la imagen no parece un comprobante. */
export const ATTACHMENT_RECEIVED_MESSAGE =
  "Gracias, ya lo recibimos 🙌 El equipo lo revisa y te confirma a la brevedad";


/**
 * Confirmación de pago aprobado (PATCH /api/payments/[id]) cuando ya tenemos
 * el correo de la persona (o ya se lo pedimos por este pago). Voz de
 * Valentina: cálida, con emoji, sin punto final.
 */
export const PAYMENT_APPROVED_MESSAGE =
  "Buenísimo, tu pago quedó verificado ✅ En breve te enviamos el acceso a tu correo, cualquier cosa quedamos en contacto 🙌🏻";

/**
 * Pago aprobado de un CUPO ADICIONAL (evento hermano, sin alta en Tiendup).
 * UNA sola constante, fácil de cambiar: no menciona Tiendup, la web ni "el
 * acceso por correo". PLACEHOLDER hasta que Federico confirme cómo se da el
 * acceso: cuando lo sepa, se edita acá (y nada más). Se usa también al validar
 * el título cuando el pago del cupo adicional ya estaba aprobado.
 *
 * No tiene plantilla de Meta: si la ventana de 24 h está cerrada, la entrega
 * falla, el comprobante queda con "No se avisó al cliente" y el equipo avisa a
 * mano (mismo camino que cualquier aviso sin plantilla).
 */
export const EXTENSION_PAYMENT_APPROVED_MESSAGE =
  "Tu pago fue verificado y tu lugar quedó confirmado ✨ En los próximos días te contamos cómo vas a acceder a la masterclass.";

/**
 * Confirmación de pago aprobado cuando todavía NO tenemos su correo: reemplaza
 * a PAYMENT_APPROVED_MESSAGE (un solo mensaje, no dos). Se usa si no se le
 * pidió ya al recibir el comprobante (o ese pedido no se entregó). También
 * figura en knowledge-base.md (el evaluator no ve el orquestador).
 */
export const PAYMENT_APPROVED_ASK_EMAIL_MESSAGE =
  "Buenísimo, tu pago quedó verificado ✅ Para darte el acceso, me pasás el correo con el que te inscribiste en la web? 📩";

/**
 * Título validado cuando el pago YA estaba verificado (aprobación forzada) y
 * falta el correo: confirma el título y pide el correo en el mismo mensaje.
 */
export const TITLE_VALIDATED_ASK_EMAIL_MESSAGE =
  "Listo, validé tu título ✨ Tu pago ya está verificado, para darte el acceso me pasás el correo con el que te inscribiste en la web? 📩";

/** Título validado cuando el pago ya estaba verificado y tenemos el correo. */
export const TITLE_VALIDATED_PAYMENT_OK_MESSAGE =
  "Listo, validé tu título ✨ Tu pago ya está verificado, en breve te enviamos el acceso a tu correo 🙌";

/** Título validado con un comprobante en revisión (ya tenemos el correo o ya se pidió). */
export const TITLE_VALIDATED_COMPROBANTE_MESSAGE =
  "Listo, validé tu título ✨ Ya tengo tu comprobante, el equipo revisa la inscripción y te confirma a la brevedad 🙌";

/** Título validado con un comprobante en revisión y sin correo: lo pide en el mismo mensaje. */
export const TITLE_VALIDATED_COMPROBANTE_ASK_EMAIL_MESSAGE =
  "Listo, validé tu título ✨ Ya tengo tu comprobante, el equipo revisa la inscripción y te confirma a la brevedad 🙌 Mientras tanto, me pasás el correo con el que te inscribiste en la web? 📩";

/**
 * Pedido del correo suelto. Hasta el 18/11/2026 se mandaba en una burbuja
 * aparte al recibir el comprobante, antes de que nada estuviera aprobado (se
 * leía inconexo). Ya no se manda: queda para que el importador de mensajes del
 * equipo siga reconociendo los envíos viejos y para el chequeo de "ya se lo
 * pedimos".
 */
export const EMAIL_REQUEST_MESSAGE =
  "Para darte el acceso, me pasás el correo con el que te inscribiste en la web? 📩";

/** Todos los textos que piden el correo (para no pedirlo dos veces por el mismo pago). */
export const EMAIL_ASK_MESSAGES: readonly string[] = [
  COMPROBANTE_RECEIVED_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_COMPROBANTE_ASK_EMAIL_MESSAGE,
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_ASK_EMAIL_MESSAGE,
  EMAIL_REQUEST_MESSAGE,
  WHATSAPP_TEMPLATE_BODIES.pago_verificado_mail,
];

// Marca para distinguir el aviso fallido de una derivación del agente.
export const APPROVAL_NOTICE_FAILED_PREFIX = "pago_aviso_sin_enviar_";
