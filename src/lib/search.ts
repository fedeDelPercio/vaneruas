// ===========================================================================
// Búsqueda de contactos por nombre, teléfono o correo. La usan el chat y las
// bandejas (Aprobaciones, Derivaciones, Certificados, Agendar), así buscar
// "maria" o "1165" se comporta igual en todos lados.
//
// Reglas:
//  - El texto ignora mayúsculas y tildes ("maria" encuentra "María").
//  - Varias palabras: tienen que aparecer todas ("ponce tam" encuentra
//    "Tamara Ponce").
//  - Un número se compara contra los teléfonos mirando solo los dígitos, con
//    cualquier separador ("11 6574", "11-6574", "11.6574").
//  - Los teléfonos se guardan en formato internacional (+54 9 11 ...). Como en
//    Argentina se dictan con 0 y 15 ("011 15 6574-6690"), también se prueba
//    sin esos prefijos.
//  - Se puede mezclar nombre y número ("tamara 6574").
// ===========================================================================

/** Minúsculas y sin tildes, para comparar texto. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Solo los dígitos de un teléfono. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export interface ContactSearchFields {
  /** Nombres y otros textos donde buscar (nombre del contacto, del emisor, correo). */
  texts: Array<string | null | undefined>;
  /** Teléfonos del contacto. */
  phones?: Array<string | null | undefined>;
}

/** ¿El texto es un número de teléfono (o un tramo), con sus separadores? */
function isNumeric(text: string): boolean {
  return /^[\d\s+\-().]+$/.test(text) && onlyDigits(text).length >= 3;
}

/**
 * Formas de buscar un mismo número: tal cual, sin el 0 del código de área, y
 * sin el 15 de los celulares (al principio o después del área).
 */
function digitVariants(digits: string): string[] {
  const out = new Set<string>([digits]);
  const sin0 = digits.replace(/^0+/, "");
  if (sin0.length >= 3) out.add(sin0);
  if (sin0.startsWith("15") && sin0.length >= 5) out.add(sin0.slice(2));
  // "011 15 6574 6690" -> "1165746690": el 15 queda entre el área y el número.
  for (const areaLen of [2, 3, 4]) {
    if (sin0.slice(areaLen, areaLen + 2) === "15" && sin0.length >= areaLen + 5) {
      out.add(sin0.slice(0, areaLen) + sin0.slice(areaLen + 2));
    }
  }
  return Array.from(out);
}

function phoneMatches(queryDigits: string, phones: string[]): boolean {
  const variants = digitVariants(queryDigits);
  return phones.some((p) => variants.some((v) => p.includes(v)));
}

/** ¿El contacto coincide con lo que se escribió en el buscador? Vacío = todos. */
export function matchesContactQuery(query: string, fields: ContactSearchFields): boolean {
  const q = normalizeText(query);
  if (!q) return true;

  const phones = (fields.phones ?? [])
    .filter((p): p is string => Boolean(p))
    .map(onlyDigits)
    .filter(Boolean);
  const haystack = normalizeText(fields.texts.filter(Boolean).join(" "));

  // Toda la búsqueda es un número: alcanza con que algún teléfono lo contenga.
  if (isNumeric(q) && phoneMatches(onlyDigits(q), phones)) return true;

  // Palabra por palabra: cada una tiene que estar en el texto, o ser un tramo
  // de teléfono.
  // La puntuación pegada a una palabra no cuenta ("ponce, tamara"), y los
  // tramos de un número escritos con espacios se juntan ("tamara 011 6574").
  const words: string[] = [];
  for (const raw of q.split(/\s+/)) {
    const w = /^[\d+\-().]+$/.test(raw) ? raw : raw.replace(/^[,;:()"']+|[,;:()"']+$/g, "");
    if (!w) continue;
    const prev = words[words.length - 1];
    const numeric = /^[\d+\-().]+$/.test(w);
    if (numeric && prev !== undefined && /^[\d+\-().\s]+$/.test(prev)) {
      words[words.length - 1] = `${prev} ${w}`;
    } else {
      words.push(w);
    }
  }
  return (
    words.length > 0 &&
    words.every(
      (w) => haystack.includes(w) || (isNumeric(w) && phoneMatches(onlyDigits(w), phones)),
    )
  );
}

/**
 * Teléfono legible. Celulares argentinos: "+54 9 11 6574-6690". El resto, con
 * el + adelante si trae código de país, o tal cual si no se puede saber.
 */
export function formatPhone(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  // Identificadores de WhatsApp ("5491165746690:12@s.whatsapp.net"): solo el número.
  const digits = onlyDigits(raw.split(/[:@]/)[0] ?? raw);
  if (!digits) return raw;
  if (digits.length === 13 && digits.startsWith("549")) {
    // No se puede saber el largo del código de área sin la tabla completa: se
    // separa bien Buenos Aires (11) y el resto queda en un solo bloque.
    if (digits.startsWith("54911")) {
      return `+54 9 11 ${digits.slice(5, 9)}-${digits.slice(9)}`;
    }
    return `+54 9 ${digits.slice(3, 9)}-${digits.slice(9)}`;
  }
  // Con código de país (11 dígitos o más) o escrito con +: formato internacional.
  if (raw.startsWith("+") || digits.length >= 11) return `+${digits}`;
  return digits;
}
