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

// --- Error "el mail no figura en Tiendup" -----------------------------------
//
// Cuando el alta automática se frena porque el correo no existe como cliente
// de la tienda, se guarda en payment_validations.course_access_error con este
// prefijo estable (sin schema nuevo). La ficha (status.ts) lo reconoce y lo
// muestra como `not_found` aunque la consulta en vivo a Tiendup falle. Se
// limpia solo cuando el acceso queda dado (markGranted pone el error en null)
// o lo pisa un error posterior del alta.

export const NOT_IN_TIENDUP_PREFIX = "NOT_IN_TIENDUP:";
export const NOT_IN_TIENDUP_TEXT = "El mail no figura en Tiendup";

/** Valor de course_access_error para "el mail no figura en Tiendup". */
export function notInTiendupError(): string {
  return `${NOT_IN_TIENDUP_PREFIX} ${NOT_IN_TIENDUP_TEXT}`;
}

/** ¿El error guardado es el de "el mail no figura en Tiendup"? */
export function isNotInTiendupError(error: string | null | undefined): boolean {
  return Boolean(error?.trim().startsWith(NOT_IN_TIENDUP_PREFIX));
}

/** Error guardado para mostrar en el panel: sin el prefijo técnico ni HTML crudo. */
export function displayCourseAccessError(error: string | null | undefined): string | null {
  const e = error?.trim();
  if (!e) return null;
  return isNotInTiendupError(e)
    ? e.slice(NOT_IN_TIENDUP_PREFIX.length).trim() || NOT_IN_TIENDUP_TEXT
    : tidyTiendupError(e);
}

// --- Errores de la API de Tiendup legibles ----------------------------------

const TIENDUP_HTTP_ERROR_RE = /^Tiendup (\d{3}):\s*([\s\S]*)$/;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Texto de error de Tiendup apto para guardar y mostrar: sin HTML crudo y
 * acotado. "Tiendup 403: <div>site not found</div>" → "Tiendup no respondió
 * (403 site not found)". Un 4xx de validación con cuerpo de texto/JSON queda
 * "Tiendup 422: <detalle>". Idempotente: un texto ya prolijo vuelve igual.
 */
export function tidyTiendupError(raw: string): string {
  const m = TIENDUP_HTTP_ERROR_RE.exec(raw.trim());
  if (!m) return stripHtml(raw).slice(0, 200);
  const status = Number(m[1]);
  const body = m[2] ?? "";
  const hadHtml = /<[a-z!/][^>]*>/i.test(body);
  const text = stripHtml(body).slice(0, 120);
  if (hadHtml || status === 429 || status >= 500 || (status === 403 && /site not found/i.test(text))) {
    return `Tiendup no respondió (${status}${text ? ` ${text}` : ""})`;
  }
  return `Tiendup ${status}: ${text}`.trim().slice(0, 200);
}

// --- Corrección manual del mail desde la ficha ------------------------------

/** Nota de sistema cuando el equipo carga o corrige el mail desde la ficha. */
export function manualEmailNote(actor: string, previous: string | null, next: string): string {
  const who = actor.trim() || "sin perfil";
  return `Mail corregido por el equipo (${who}): ${previous?.trim() || "sin mail"} → ${next}`;
}
