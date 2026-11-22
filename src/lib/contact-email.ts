// ===========================================================================
// Correo de la contacta: extracción y validación.
//
// El correo se usa para dar de alta en Tiendup. Un correo basura (truncado,
// con espacios, de ejemplo) crea un cliente fantasma en Tiendup y la persona
// real se queda sin acceso, así que solo se guarda lo que pasa este filtro.
// Las correcciones de dominio ("gmail.con") las hace `fixDominioDeCorreo` al
// momento de inscribir, no acá.
//
// Sin "server-only": lo usan el worker y los tests de scripts/.
// ===========================================================================

/** Candidatos a correo dentro de un texto libre (se validan después). */
const EMAIL_CANDIDATE_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Local: letras, números y . _ % + -, sin empezar ni terminar con punto.
// Dominio: etiquetas de letras/números/guiones y un TLD de 2 a 24 letras.
const EMAIL_STRICT_RE =
  /^[a-z0-9_%+-](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

// Dominios de ejemplo o de relleno: nadie se inscribe con estos.
const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "ejemplo.com",
  "test.com",
  "dominio.com",
  "correo.com",
]);

/**
 * Normaliza y valida un correo. Devuelve el correo en minúsculas y sin
 * espacios, o null si no sirve para dar un acceso.
 */
export function normalizeContactEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw
    .trim()
    // Lo que suele venir pegado al copiar: <correo>, "correo", correo. o correo,
    .replace(/^[<"'(\[]+/, "")
    .replace(/[>"')\].,;:!?]+$/, "")
    .toLowerCase();
  if (!email || email.length > 254) return null;
  if (!EMAIL_STRICT_RE.test(email)) return null;
  if (email.includes("..")) return null;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (PLACEHOLDER_DOMAINS.has(domain)) return null;
  return email;
}

/** ¿Este correo sirve para dar un acceso? */
export function isValidContactEmail(raw: string | null | undefined): boolean {
  return normalizeContactEmail(raw) !== null;
}

// Prefijo pegado al correo con guión ("Correo-juana@gmail.com"): el guión es
// válido en la parte local, así que sin esto se guardaría "correo-juana@…".
// Con ":" no hace falta (no entra en el candidato). Sin separador no se toca:
// "mailen@gmail.com" es un nombre.
const GLUED_PREFIX_RE = /^(?:e-?mail|mail|correo)[-–]+(?=[a-z0-9])/i;

// Palabras que, en un dictado, quedan como "parte local" sin serlo
// ("mi mail es @gmail.com" → "es@gmail.com"). Solo se miran en la pasada
// tolerante.
const DICTATION_STOPWORDS = new Set([
  "es", "mi", "mail", "email", "correo", "arroba", "at", "gmail", "hotmail", "a", "el", "ig", "instagram",
]);

// TLDs con los que se acepta un correo armado por la pasada tolerante (con
// espacios o dictado). Corta los falsos positivos de un handle de Instagram
// con punto ("@juan.perez") y el texto pegado detrás ("gmail.com. Gracias" →
// "gmail.com.gracias" se recorta a "gmail.com").
const TOLERANT_TLDS = new Set([
  "com", "net", "org", "edu", "gov", "info", "io", "me",
  "ar", "uy", "cl", "py", "bo", "pe", "br", "mx", "co", "ve", "ec", "es", "us", "it", "fr", "de", "uk",
  // Typos de ".com" que corrige fixDominioDeCorreo (match.ts) al inscribir.
  "con", "cmo", "om",
]);

function stripGluedPrefix(candidate: string): string {
  return candidate.replace(GLUED_PREFIX_RE, "");
}

/**
 * Candidato de la pasada tolerante: sin palabras de dictado como parte local
 * y con un TLD conocido (recortando etiquetas sobrantes al final del dominio).
 */
function acceptTolerantCandidate(candidate: string): string | null {
  const at = candidate.lastIndexOf("@");
  if (at < 1) return null;
  const local = candidate.slice(0, at);
  if (DICTATION_STOPWORDS.has(local.toLowerCase())) return null;
  const labels = candidate.slice(at + 1).replace(/\.+$/, "").split(".");
  while (labels.length >= 2 && !TOLERANT_TLDS.has(labels[labels.length - 1]!.toLowerCase())) labels.pop();
  if (labels.length < 2) return null;
  return normalizeContactEmail(`${local}@${labels.join(".")}`);
}

/**
 * Normaliza un texto dictado o con espacios para que el correo quede pegado:
 * "arroba" / "(at)" / "[at]" → "@", " punto " → ".", sin espacios alrededor de
 * la "@" ni de los puntos del dominio. Solo se usa como segunda pasada: lo que
 * arma se acepta únicamente si pasa `acceptTolerantCandidate` (y el filtro
 * estricto de siempre).
 */
function relaxEmailText(text: string): string {
  return text
    .replace(/\s*(?:\(at\)|\[at\]|\barroba\b)\s*/gi, "@")
    .replace(/\s+punto\s+/gi, ".")
    .replace(/\s*@\s*/g, "@")
    .replace(/@([A-Za-z0-9-]+(?:\s*\.\s*[A-Za-z0-9-]+)+)/g, (_m, dom: string) => `@${dom.replace(/\s+/g, "")}`);
}

/**
 * Primer correo válido que aparezca en un texto libre, o null.
 *
 * Dos pasadas: primero el texto tal cual (el caso normal, mismo resultado que
 * siempre); si ahí no hay ninguno, una pasada tolerante que acepta espacios
 * alrededor de la "@" o del punto ("nombre @gmail.com", "nombre@ gmail .com") y
 * el dictado ("nombre arroba gmail punto com"). En las dos se saca un prefijo
 * pegado con guión ("Correo-nombre@…"). Los dominios mal escritos
 * ("hotmail.con") se aceptan acá y los corrige `fixDominioDeCorreo` al
 * inscribir.
 */
export function extractContactEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const m of text.matchAll(EMAIL_CANDIDATE_RE)) {
    const email = normalizeContactEmail(stripGluedPrefix(m[0]));
    if (email) return email;
  }
  // Pasada tolerante: solo si el texto da alguna pista de correo.
  if (!/@|\barroba\b|\(at\)|\[at\]/i.test(text)) return null;
  for (const m of relaxEmailText(text).matchAll(EMAIL_CANDIDATE_RE)) {
    const email = acceptTolerantCandidate(stripGluedPrefix(m[0]));
    if (email) return email;
  }
  return null;
}

/**
 * Correo más reciente en una lista de mensajes de la contacta ordenada del
 * más nuevo al más viejo (el `content` de un mensaje con adjunto es su
 * caption). null si ninguno trae un correo válido.
 */
export function findEmailInMessages(
  messages: readonly { content: string | null | undefined }[],
): string | null {
  for (const m of messages) {
    const hit = extractContactEmail(m.content);
    if (hit) return hit;
  }
  return null;
}

// Correo a medio escribir. La parte local va pegada a la "@" (así "hola
// @usuario" no cuenta); el dominio puede faltar, no tener TLD o venir con
// espacios.
const INCOMPLETE_EMAIL_RE =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([ \t]*)([A-Za-z0-9-]+(?:[ \t]*\.[ \t]*[A-Za-z0-9-]*)*)?/g;
// Con espacio antes de la "@" solo se acepta un proveedor conocido: "nombre
// @gmail" es un correo, "seguime @usuario" es un handle.
// Sin cruzar saltos de línea: "nombre@gmail.\nEntrenadora…" (caso real
// 5ebc4e67) no es un dominio "gmail.entrenadora", es un correo cortado.
const INCOMPLETE_SPACED_RE =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)[ \t]+@[ \t]*((?:gmail|hotmail|outlook|yahoo|live|icloud)(?:[ \t]*\.[ \t]*[A-Za-z0-9-]*)*)/gi;
const KNOWN_PROVIDER_RE = /^(?:gmail|hotmail|outlook|yahoo|live|icloud)\b/i;

function maskIncomplete(local: string, domain: string): string {
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Forma ENMASCARADA de un correo incompleto en el texto ("n***@gmail."), o
 * null si no hay ninguno o si el texto ya trae un correo válido. Nunca devuelve
 * la parte local: esto va al contexto del agente y puede terminar en logs.
 */
export function findIncompleteEmail(text: string | null | undefined): string | null {
  if (!text || !text.includes("@")) return null;
  if (extractContactEmail(text)) return null;
  for (const m of text.matchAll(INCOMPLETE_EMAIL_RE)) {
    const local = m[1]!;
    if (DICTATION_STOPWORDS.has(local.toLowerCase())) continue;
    const domain = (m[3] ?? "").replace(/\s+/g, "");
    // Con TLD no es "incompleto" (es un dominio de relleno u otro descarte).
    if (/\.[a-z]{2,}$/i.test(domain)) continue;
    // "hola@ como estas": tras un espacio solo vale un proveedor conocido.
    if (m[2] && domain && !KNOWN_PROVIDER_RE.test(domain)) continue;
    return maskIncomplete(local, domain);
  }
  for (const m of text.matchAll(INCOMPLETE_SPACED_RE)) {
    const local = m[1]!;
    if (DICTATION_STOPWORDS.has(local.toLowerCase())) continue;
    const domain = m[2]!.replace(/\s+/g, "");
    if (/\.[a-z]{2,}$/i.test(domain)) continue;
    return maskIncomplete(local, domain);
  }
  return null;
}

/**
 * Qué hacer cuando llega un correo en el chat:
 * - `ignore`: no trae correo, o es el mismo que ya teníamos.
 * - `set`: no teníamos correo válido, se guarda.
 * - `replace`: teníamos otro, pero todavía no hubo pago validado ni intento de
 *   alta: la persona lo está corrigiendo y se pisa.
 * - `keep_and_note`: teníamos otro y ya hubo pago validado o intento de alta.
 *   NO se pisa (el acceso va al correo de la web, y cambiarlo lo decide el
 *   equipo si la persona lo pide): se deja una nota de sistema con el nuevo.
 *   Excepción: compra nueva (ver `NewPurchaseContext`), ahí se pisa.
 */
export type ContactEmailUpdate = "ignore" | "set" | "replace" | "keep_and_note";

/**
 * Margen antes del primer comprobante en el que un correo ya cuenta como de
 * esa compra: lo normal es escribir "nombre + mail" y mandar la foto después.
 */
export const NEW_PURCHASE_EMAIL_GRACE_MS = 60 * 60 * 1000;

/** Datos de la compra en curso para decidir si un correo nuevo pisa al guardado. */
export interface NewPurchaseContext {
  /** Primer comprobante del evento de la compra en curso. */
  periodStartIso: string;
  /** Cuándo escribió el correo nuevo. */
  incomingAtIso: string;
  /** Primera vez que el correo guardado aparece en el chat. null = nunca. */
  storedFirstSeenAtIso: string | null;
  /** Algún pago de este evento ya tiene el acceso dado (con el correo guardado). */
  periodAccessGranted: boolean;
  /** Otro evento validado espera su acceso: el alta usaría el correo nuevo. */
  otherEventAwaitingAccess: boolean;
  /** El equipo corrigió el correo a mano durante esta compra: manda el equipo. */
  teamCorrectedInPeriod: boolean;
}

/**
 * ¿El correo nuevo es el de una compra nueva? Sí si se escribió dentro del
 * período y el guardado es anterior a ese período (o nunca estuvo en el chat),
 * salvo que esta compra ya tenga acceso, que el equipo lo haya corregido, o que
 * pisarlo desvíe el acceso pendiente de otro evento.
 */
export function isNewPurchaseEmail(p: NewPurchaseContext): boolean {
  if (p.periodAccessGranted || p.otherEventAwaitingAccess || p.teamCorrectedInPeriod) return false;
  const from = new Date(p.periodStartIso).getTime() - NEW_PURCHASE_EMAIL_GRACE_MS;
  if (!Number.isFinite(from)) return false;
  const incomingAt = new Date(p.incomingAtIso).getTime();
  if (!Number.isFinite(incomingAt) || incomingAt < from) return false;
  if (p.storedFirstSeenAtIso === null) return true;
  const storedAt = new Date(p.storedFirstSeenAtIso).getTime();
  return Number.isFinite(storedAt) && storedAt < from;
}

export function decideContactEmailUpdate(args: {
  current: string | null;
  incoming: string | null;
  /** Hay un pago validado o un intento de alta en Tiendup (dado o fallido). */
  accessInProgress: boolean;
  /** Compra en curso, si se pudo leer. Sin esto, la regla de siempre. */
  purchase?: NewPurchaseContext | null;
}): ContactEmailUpdate {
  const current = normalizeContactEmail(args.current);
  const incoming = normalizeContactEmail(args.incoming);
  if (!incoming || incoming === current) return "ignore";
  if (!current) return "set";
  if (!args.accessInProgress) return "replace";
  return args.purchase && isNewPurchaseEmail(args.purchase) ? "replace" : "keep_and_note";
}

/** Nota de sistema para el equipo cuando no se pisa el correo (sin punto final). */
export function secondEmailNote(current: string, incoming: string): string {
  return `Otro correo en el chat: ${incoming} · El acceso sigue con ${current}`;
}

/** Nota de sistema cuando el correo de una compra nueva pisa al anterior. */
export function newPurchaseEmailNote(previous: string, next: string): string {
  return `Correo actualizado para esta inscripción: ${previous} → ${next}`;
}
