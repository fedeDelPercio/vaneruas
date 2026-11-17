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
