// ===========================================================================
// Textos y marcas del flujo de acceso a Tiendup.
//
// Sin "server-only": los usan también el importador de mensajes del equipo y
// los tests de scripts/.
// ===========================================================================

/**
 * Aviso por WhatsApp cuando el acceso a Tiendup queda efectivo (alta
 * automática o botón "Dar acceso al curso"). Texto fijo pedido por el cliente:
 * sale tal cual, sin sanitize, en una sola burbuja.
 */
export const TIENDUP_ACCESS_MESSAGE =
  "Ya te enviamos el link de acceso al grupo de WhatsApp al correo con el que te inscribiste en la web ♥️ recorda revisa en spam o correo no deseado!";

// Marcas en agent_notifications.reason para las notificaciones que genera el
// sistema (no el agente) sobre el acceso a Tiendup. La columna `reason` no se
// muestra en el panel ni en el email: sirve para encontrar la notificación de
// un pago puntual (dedup y resolución) y para que el agente no las confunda
// con una derivación suya. Prefijo común "tiendup_" (ver
// SYSTEM_NOTIFICATION_REASON_LIKE).

/** Alta automática que no se pudo hacer: el equipo tiene que dar el acceso a mano. */
export function enrollmentPendingReason(paymentId: string): string {
  return `tiendup_alta_pendiente_${paymentId}`;
}

/** Alta hecha, pero el aviso por WhatsApp no salió. */
export function accessNoticeFailedReason(paymentId: string): string {
  return `tiendup_aviso_sin_enviar_${paymentId}`;
}

/** Patrón (sintaxis PostgREST, `*` = `%`) de las notificaciones de sistema de Tiendup. */
export const SYSTEM_NOTIFICATION_REASON_LIKE = "tiendup_*";

/** Resumen que ve el equipo en Derivaciones para un alta pendiente. */
export function enrollmentPendingSummary(motivo: string): string {
  return `Alta en Tiendup pendiente: ${motivo}. Dar acceso a mano desde Aprobaciones → Falta acceso`;
}

export const ACCESS_NOTICE_FAILED_SUMMARY =
  "Se le dio el acceso en Tiendup, pero no se le pudo avisar por WhatsApp (probable ventana de 24 h vencida). Avisale a mano que el link del grupo le llegó al correo con el que se inscribió";
