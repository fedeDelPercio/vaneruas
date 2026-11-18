// ===========================================================================
// Match de una persona contra el listado de inscriptos de un curso de Tiendup.
//
// Puro y sin "server-only": lo usan client.ts (alta), status.ts (bloque en
// vivo de la ficha) y los tests de scripts/, sin red.
// ===========================================================================

export interface TiendupEnrolled {
  name: string | null;
  lastName: string | null;
  email: string | null;
}

export interface ExistingEnrollment {
  /** "email" = coincide el mail; "nombre" = coincide la persona pero con OTRO mail. */
  matchedBy: "email" | "nombre";
  enrolled: TiendupEnrolled;
}

/** normaliza para comparar: minúsculas, sin acentos, solo alfanumérico. */
function normLoose(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * ¿Esta persona ya está inscripta en el curso? Busca por mail (exacto, y también
 * "limpiando" basura al principio, ej. "_mail@x.com") y, si no, por NOMBRE
 * (todos los tokens del nombre presentes en el inscripto). Devuelve el match, o
 * null si no aparece.
 */
export function findExistingEnrollment(args: {
  enrolled: TiendupEnrolled[];
  email: string;
  fullName?: string | null;
}): ExistingEnrollment | null {
  const emailNorm = normLoose(args.email);
  // a) match por mail (normLoose saca guiones bajos/puntos, así que cubre los
  //    mails mal capturados tipo "_florencia...@gmail.com").
  const byEmail = args.enrolled.find((e) => e.email && normLoose(e.email) === emailNorm);
  if (byEmail) return { matchedBy: "email", enrolled: byEmail };

  // b) match por nombre: todos los tokens significativos del nombre tienen que
  //    estar en el nombre+apellido del inscripto.
  const tokens = (args.fullName ?? "")
    .split(/\s+/)
    .map(normLoose)
    .filter((t) => t.length > 3);
  if (tokens.length >= 2) {
    const byName = args.enrolled.find((e) => {
      const full = normLoose(`${e.name ?? ""}${e.lastName ?? ""}`);
      return tokens.every((t) => full.includes(t));
    });
    if (byName) return { matchedBy: "nombre", enrolled: byName };
  }
  return null;
}

// Dominios mal tipeados que vemos seguido en los correos dictados por WhatsApp.
// Solo correcciones INEQUÍVOCAS: si hay la menor duda, el correo se deja como
// vino (inscribir con un mail equivocado crea un cliente basura en Tiendup y la
// persona real se queda sin acceso).
const TYPOS_DE_DOMINIO: Record<string, string> = {
  "gmail.con": "gmail.com",
  "gmail.cmo": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.co": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "hotmail.con": "hotmail.com",
  "hotmail.cmo": "hotmail.com",
  "hotmail.om": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "outlook.con": "outlook.com",
  "yahoo.con": "yahoo.com",
  "icloud.con": "icloud.com",
};

/**
 * Corrige errores de tipeo obvios en el dominio del correo. Devuelve el correo
 * corregido y si hubo cambio, para poder avisarlo en el panel en vez de
 * inscribir en silencio con otro mail.
 */
export function fixDominioDeCorreo(email: string): { email: string; fixed: boolean } {
  const at = email.lastIndexOf("@");
  if (at < 1) return { email, fixed: false };
  const user = email.slice(0, at);
  const dom = email.slice(at + 1).toLowerCase();
  const fix = TYPOS_DE_DOMINIO[dom];
  return fix ? { email: `${user}@${fix}`, fixed: true } : { email, fixed: false };
}
