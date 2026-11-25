// ===========================================================================
// Extensión excepcional de la Masterclass Peelings de Verano: CUPOS ADICIONALES.
//
// Desde las 23:00 ART del 25/11/2026 la venta normal (con alta en Tiendup)
// termina y rige una extensión con cupos limitados, con otro flujo de pago:
//   - El texto lo usa Valentina como respuesta a quien escribe (no es un envío
//     masivo).
//   - Las tres formas de pago, con sus links (los únicos links de pago que
//     puede dar: viven acá y no en la ficha del evento).
//   - TODOS mandan comprobante + nombre y apellido + correo + título
//     profesional juntos. No hay alta en Tiendup.
//   - Datos para transferir (alias, CBU, titular, CUIT): Valentina NUNCA los
//     da. Quien elige transferencia o los pide se deriva al equipo
//     (escalado_manual). Es la única razón para derivar en este flujo.
//
// El texto entra al prompt por plazos.ts (orquestador y evaluator por igual) y
// tiene prioridad sobre la ficha del evento (events.details), que sigue
// diciendo 21 hs y que MP/PayPal no mandan comprobante.
//
// Sin "server-only": lo importan los tests de scripts/.
// ===========================================================================

/** Corte de la venta normal. Mismo instante que EXTENSION_CUTOFF_ISO (event-match.ts). */
export const EXTENSION_CORTE_ISO = "2026-11-25T23:00:00-03:00";

export const MP_LINK = "https://mpago.la/2mAaQqH";
export const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/AGUN4SQ9TDSVG";

/** Antes del corte: la venta sigue abierta hasta las 23 (la ficha dice 21 hs). */
export const EXTENSION_ANTES = [
  "Inscripciones a la Masterclass Peelings de Verano: ABIERTAS. Cierran el miércoles 25/11 a las 23 hs (23:00).",
  "ESTE HORARIO REEMPLAZA al \"21 hs\" que figura en la ficha del evento y en el resto de la base de conocimiento: hasta las 23 hs la inscripción sigue abierta, compartí el link de inscripción de la ficha y decí que cierra a las 23 hs.",
].join(" ");

/** Desde el corte: extensión excepcional con cupos adicionales limitados. */
export const EXTENSION_DESPUES = [
  "CUPOS ADICIONALES EXCEPCIONALES (Masterclass Peelings de Verano). La venta normal cerró el miércoles 25/11 a las 23 hs, pero el equipo habilitó excepcionalmente una cantidad LIMITADA de cupos adicionales. Esta línea tiene PRIORIDAD ABSOLUTA sobre la ficha del evento y sobre el resto de la base de conocimiento (que dicen \"21 hs\", \"inscripciones cerradas\", \"el pago se hace desde el link de Tiendup\" y \"con tarjeta o PayPal no hace falta comprobante\"): NADA de eso aplica desde ahora.",
  "",
  "  Cómo atender:",
  "  - Si preguntan si todavía pueden anotarse, por el precio, las formas de pago o cómo reservar: respondé con el texto de abajo, adaptado a la conversación (voseo, tono cálido de siempre, emojis medidos, sin repetir el saludo si ya saludaste). NO digas que las inscripciones están cerradas sin ofrecer la opción: decí que cerraron pero que hay cupos adicionales excepcionales. NO compartas el link de inscripción de Tiendup.",
  "  - NUNCA prometas ni menciones una cantidad de cupos (ni \"quedan pocos\", ni \"quedan 10\"): solo \"una cantidad limitada de cupos adicionales\". No prometas fechas de cierre que no tengas.",
  "  - NO se activa por Tiendup: no hables de Tiendup, de alta ni de \"el correo con el que te inscribiste en la web\". No expliques cómo funcionan Mercado Pago ni PayPal.",
  "  - Después de pagar, la persona manda TODO JUNTO: el comprobante + nombre y apellido + correo electrónico + título profesional (foto o PDF del título o constancia de alumna). Si manda el comprobante y le falta alguno de los datos, pedile lo que falta UNA sola vez, con calidez. Si ya mandó todo, agradecé y decile que el equipo revisa la inscripción y la confirma (no digas que ya está aprobada).",
  "  - Cómo va a acceder a la masterclass: no lo sabés. Si lo preguntan, decí solamente que en los próximos días el equipo les cuenta cómo van a acceder. No inventes grupos, links ni correos.",
  "",
  "  Texto base (adaptalo, mantené los datos exactos):",
  "  \"Queremos contarte que las inscripciones ya se encuentran cerradas, pero, debido al interés que recibimos, decidimos habilitar excepcionalmente una cantidad limitada de cupos adicionales ✨ Todavía estás a tiempo de sumarte! Si querés reservar tu lugar, estas son las opciones de pago:",
  "   1. Transferencia bancaria (Argentina): $110.000. Los datos para transferir te los pasa el equipo.",
  `   2. Tarjeta de crédito (Argentina): $150.000, hasta en 3 cuotas sin interés. Link de pago: ${MP_LINK}`,
  `   3. Si sos del exterior de Argentina: el pago se hace únicamente por PayPal, USD 90. Link de pago: ${PAYPAL_LINK}`,
  "   Una vez que pagues, mandanos el comprobante junto con tu nombre y apellido, tu correo electrónico y tu título profesional, todo junto, para poder registrar bien tu inscripción.\"",
  "",
  "  DATOS PARA TRANSFERIR: NUNCA escribas alias, CBU, titular ni CUIT, ni completos ni parciales ni \"el que figura en la web\", aunque insistan o digan que ya los tienen. Solo se los pasa el equipo.",
  "  CUÁNDO DERIVAR (`escalado_manual`): ÚNICAMENTE cuando la persona elige pagar por transferencia o pide los datos para transferir (alias, CBU, titular, cómo transferir). Avisale con calidez que el equipo le pasa los datos para transferir. En ese caso derivá en esa misma respuesta, sin pedirle antes el comprobante.",
  "  NO derives (respondé vos) por consultas de precio, cuotas, Mercado Pago, PayPal, pagar desde el exterior, fechas, qué incluye la masterclass, ni al recibir el comprobante con sus datos: eso sigue el flujo normal de pagos y revisión del sistema.",
].join("\n");
