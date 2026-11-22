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

// --- Marcadores de la cola de reintentos (retry-pending.ts) -------------------
//
// Sin schema nuevo: viven en course_access_error.
//   RETRY_AUTO: [iso] texto    en cola, se reintenta en automático;
//   RETRY_MANUAL: [iso] texto  en cola, lo pidió el equipo (puede crear cliente);
//   RETRY_GAVE_UP: texto       pasaron 24 h, ya no se reintenta solo;
//   NAME_CONFLICT: texto       figura con otro correo, lo resuelve una persona.
// [iso] es el primer fallo: updated_at no sirve porque cada reintento lo mueve.
//
// Variante _SILENT (RETRY_AUTO_SILENT:, RETRY_MANUAL_SILENT:,
// RETRY_GAVE_UP_SILENT:): el pedido vino de "Enviar a Tiendup" (notify: false)
// y cuando el acceso quede dado NO se le avisa a la persona por WhatsApp. Los
// marcadores sin sufijo siguen significando lo mismo que antes.

export type RetryKind = "auto" | "manual";

export const RETRY_AUTO_PREFIX = "RETRY_AUTO:";
export const RETRY_MANUAL_PREFIX = "RETRY_MANUAL:";
export const RETRY_GAVE_UP_PREFIX = "RETRY_GAVE_UP:";
export const NAME_CONFLICT_PREFIX = "NAME_CONFLICT:";
export const NAME_CONFLICT_TEXT = "Figura inscripta en Tiendup con otro correo";
const RETRY_DEFAULT_TEXT = "Tiendup no respondió";
const RETRY_RE = /^RETRY_(AUTO|MANUAL)(_SILENT)?:\s*(?:\[([^\]]+)\]\s*)?([\s\S]*)$/;
const GAVE_UP_RE = /^RETRY_GAVE_UP(?:_SILENT)?:\s*/;
const SILENT_RE = /^RETRY_(?:AUTO|MANUAL|GAVE_UP)_SILENT:/;

/** Valor de course_access_error para un caso en cola de reintento. */
export function retryError(kind: RetryKind, text: string, firstFailedAt: string, silent = false): string {
  const base = kind === "manual" ? RETRY_MANUAL_PREFIX : RETRY_AUTO_PREFIX;
  const prefix = silent ? base.replace(/:$/, "_SILENT:") : base;
  return `${prefix} [${firstFailedAt}] ${displayCourseAccessError(text) || RETRY_DEFAULT_TEXT}`;
}

/** ¿El pedido guardado es de los que no le avisan a la persona? */
export function isSilentAccessError(error: string | null | undefined): boolean {
  return SILENT_RE.test(error?.trim() ?? "");
}

/**
 * Marcador a guardar cuando un alta falla de forma transitoria. Conserva el
 * primer fallo mientras siga siendo el mismo pedido (mismo modo y misma
 * intención de aviso). Un intento automático nunca le saca el silencio a un
 * pedido silencioso. `queueOff`: la cola no estaba corriendo y al equipo se le
 * informó el error; si después se prende, se retoma en automático (no crea
 * clientes) y sin aviso.
 */
export function nextRetryError(args: {
  stored: string | null | undefined;
  mode: RetryKind;
  notify: boolean;
  text: string;
  nowIso: string;
  queueOff?: boolean;
}): string {
  const prev = parseRetryError(args.stored);
  const auto = args.mode === "auto";
  const kind: RetryKind = auto ? (prev?.kind ?? "auto") : args.queueOff ? "auto" : "manual";
  const silent = !args.notify || (auto && isSilentAccessError(args.stored));
  const same = prev?.kind === kind && prev.silent === silent;
  const first = same && prev.firstFailedAt ? prev.firstFailedAt : args.nowIso;
  return retryError(kind, args.text, first, silent);
}

/**
 * Valor de course_access_error cuando el equipo cambia el mail: el error era
 * del mail anterior y se limpia, pero un pedido silencioso sigue sin avisar
 * (vuelve a la cola en automático, con plazo nuevo).
 */
export function errorAfterEmailChange(stored: string | null | undefined, nowIso: string): string | null {
  if (!isSilentAccessError(stored)) return null;
  return retryError("auto", displayCourseAccessError(stored) ?? RETRY_DEFAULT_TEXT, nowIso, true);
}

export function parseRetryError(
  error: string | null | undefined,
): { kind: RetryKind; silent: boolean; firstFailedAt: string | null; text: string } | null {
  const m = RETRY_RE.exec(error?.trim() ?? "");
  if (!m) return null;
  return {
    kind: m[1] === "MANUAL" ? "manual" : "auto",
    silent: Boolean(m[2]),
    firstFailedAt: m[3] ?? null,
    text: m[4]?.trim() || RETRY_DEFAULT_TEXT,
  };
}

export function gaveUpError(text: string, silent = false): string {
  const prefix = silent ? RETRY_GAVE_UP_PREFIX.replace(/:$/, "_SILENT:") : RETRY_GAVE_UP_PREFIX;
  return `${prefix} ${displayCourseAccessError(text) || RETRY_DEFAULT_TEXT}`;
}

export function isGaveUpError(error: string | null | undefined): boolean {
  return GAVE_UP_RE.test(error?.trim() ?? "");
}

export function nameConflictError(): string {
  return `${NAME_CONFLICT_PREFIX} ${NAME_CONFLICT_TEXT}`;
}

export function isNameConflictError(error: string | null | undefined): boolean {
  return Boolean(error?.trim().startsWith(NAME_CONFLICT_PREFIX));
}

/** Respuesta de "Dar acceso" cuando el caso quedó en la cola. */
export const TIENDUP_QUEUED_MESSAGE =
  "Tiendup no responde ahora. Quedó en cola: se reintenta solo cada minuto y le llega el aviso cuando entre.";

/** Respuesta de "Enviar a Tiendup" en cola: ese botón nunca le escribe a la persona. */
export const TIENDUP_QUEUED_SILENT_MESSAGE =
  "Tiendup no responde ahora. Quedó en cola: se reintenta solo cada minuto.";

/** Error guardado para mostrar en el panel: sin el prefijo técnico ni HTML crudo. */
export function displayCourseAccessError(error: string | null | undefined): string | null {
  const e = error?.trim();
  if (!e) return null;
  if (isNotInTiendupError(e)) return e.slice(NOT_IN_TIENDUP_PREFIX.length).trim() || NOT_IN_TIENDUP_TEXT;
  const retry = parseRetryError(e);
  if (retry) return tidyTiendupError(retry.text);
  if (isGaveUpError(e)) return tidyTiendupError(e.replace(GAVE_UP_RE, "").trim()) || RETRY_DEFAULT_TEXT;
  if (isNameConflictError(e)) return e.slice(NAME_CONFLICT_PREFIX.length).trim() || NAME_CONFLICT_TEXT;
  return tidyTiendupError(e);
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
