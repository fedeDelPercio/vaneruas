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

/** Primer correo válido que aparezca en un texto libre, o null. */
export function extractContactEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const m of text.matchAll(EMAIL_CANDIDATE_RE)) {
    const email = normalizeContactEmail(m[0]);
    if (email) return email;
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
 */
export type ContactEmailUpdate = "ignore" | "set" | "replace" | "keep_and_note";

export function decideContactEmailUpdate(args: {
  current: string | null;
  incoming: string | null;
  /** Hay un pago validado o un intento de alta en Tiendup (dado o fallido). */
  accessInProgress: boolean;
}): ContactEmailUpdate {
  const current = normalizeContactEmail(args.current);
  const incoming = normalizeContactEmail(args.incoming);
  if (!incoming || incoming === current) return "ignore";
  if (!current) return "set";
  return args.accessInProgress ? "keep_and_note" : "replace";
}

/** Nota de sistema para el equipo cuando no se pisa el correo (sin punto final). */
export function secondEmailNote(current: string, incoming: string): string {
  return `Otro correo en el chat: ${incoming} · El acceso sigue con ${current}`;
}
