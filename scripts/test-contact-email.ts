// Tests deterministas de la extracción y validación del correo de la contacta.
//   npx tsx scripts/test-contact-email.ts
import { fixDominioDeCorreo } from "../src/lib/tiendup/match";
import {
  decideContactEmailUpdate,
  extractContactEmail,
  findEmailInMessages,
  normalizeContactEmail,
  secondEmailNote,
} from "../src/lib/contact-email";

let fail = 0;
function check(got: string | null, expected: string | null, label: string) {
  if (got === expected) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.error(`FAIL  ${label} -> esperaba ${expected}, dio ${got}`);
  }
}

// Normalización: trim, minúsculas, signos pegados.
check(normalizeContactEmail("  Juana.Perez@Gmail.com "), "juana.perez@gmail.com", "trim + minúsculas");
check(normalizeContactEmail("<juana@gmail.com>"), "juana@gmail.com", "entre <>");
check(normalizeContactEmail("juana@gmail.com."), "juana@gmail.com", "punto final pegado");
check(normalizeContactEmail("juana_99+curso@hotmail.com.ar"), "juana_99+curso@hotmail.com.ar", "subdominio .com.ar y +");
// Basura que no se guarda.
check(normalizeContactEmail("juana@gmail"), null, "sin TLD");
check(normalizeContactEmail("juana..perez@gmail.com"), null, "puntos dobles");
check(normalizeContactEmail(".juana@gmail.com"), null, "local empieza con punto");
check(normalizeContactEmail("juana@-gmail.com"), null, "dominio empieza con guión");
check(normalizeContactEmail("juana perez@gmail.com"), null, "con espacio");
check(normalizeContactEmail("nombre@example.com"), null, "dominio de ejemplo");
check(normalizeContactEmail(""), null, "vacío");
check(normalizeContactEmail(null), null, "null");

// Extracción desde texto libre.
check(extractContactEmail("Hola! soy Juana Pérez, mi mail es JUANA@gmail.com, gracias"), "juana@gmail.com", "en una oración");
check(extractContactEmail("Juana Pérez · juana@gmail.com · Masterclass"), "juana@gmail.com", "formato nombre · correo");
check(extractContactEmail("mail: nombre@example.com o juana@gmail.com"), "juana@gmail.com", "salta el de ejemplo y toma el siguiente");
check(extractContactEmail("te paso el comprobante"), null, "sin correo");
check(extractContactEmail("arroba @ gmail punto com"), null, "dictado sin formato");

// Extracción tolerante (espacios, dictado, prefijos pegados).
check(extractContactEmail("nombre @gmail.com"), "nombre@gmail.com", "espacio antes de la @");
check(extractContactEmail("mi mail es Nombre @ gmail.com gracias"), "nombre@gmail.com", "espacios a los dos lados de la @");
check(extractContactEmail("nombre@ gmail .com"), "nombre@gmail.com", "espacios alrededor del punto del dominio");
check(extractContactEmail("nombre @ gmail . com . ar"), "nombre@gmail.com.ar", "dominio .com.ar con espacios");
check(extractContactEmail("nombre arroba gmail punto com"), "nombre@gmail.com", "dictado arroba/punto");
check(extractContactEmail("juana punto perez arroba hotmail punto com"), "juana.perez@hotmail.com", "dictado con punto en la parte local");
check(extractContactEmail("juana(at)gmail.com"), "juana@gmail.com", "(at)");
check(extractContactEmail("Mail:juana@gmail.com"), "juana@gmail.com", "prefijo Mail: pegado");
check(extractContactEmail("Correo-juana@gmail.com"), "juana@gmail.com", "prefijo Correo- pegado");
check(extractContactEmail("EMAIL: juana@gmail.com"), "juana@gmail.com", "prefijo EMAIL:");
check(extractContactEmail("mailen@gmail.com"), "mailen@gmail.com", "nombre que empieza con mail no se recorta");
check(extractContactEmail("juana @ gmail.com. Gracias!"), "juana@gmail.com", "texto pegado después del dominio");
check(extractContactEmail("juana @hotmail.con"), "juana@hotmail.con", "dominio mal escrito se acepta (lo corrige fixDominioDeCorreo)");
check(extractContactEmail("Juana Pérez · juana@gmail.com · otro @ hotmail.com"), "juana@gmail.com", "primer correo válido gana");
// Falsos positivos que NO se aceptan.
check(extractContactEmail("seguime en ig @juan"), null, "handle de instagram sin dominio");
check(extractContactEmail("mi ig es @juan.perez"), null, "handle de instagram con punto");
check(extractContactEmail("te escribo a las 13:45hs"), null, "horario");
check(extractContactEmail("transferí $ 110.000 @ las 13.45"), null, "monto y hora con @");
check(extractContactEmail("mi mail es @gmail.com"), null, "sin parte local");
check(extractContactEmail("nombre @ gmail"), null, "sin TLD");

// Typos de dominio que se corrigen al inscribir (fixDominioDeCorreo).
for (const [typo, ok] of [
  ["gmial.com", "gmail.com"],
  ["gmal.com", "gmail.com"],
  ["gmail.con", "gmail.com"],
  ["gmail.co", "gmail.com"],
  ["hotmail.con", "hotmail.com"],
  ["hotmial.com", "hotmail.com"],
  ["outlook.con", "outlook.com"],
  ["yahoo.con", "yahoo.com"],
] as const) {
  check(fixDominioDeCorreo(`juana@${typo}`).email, `juana@${ok}`, `fixDominioDeCorreo ${typo}`);
}
check(fixDominioDeCorreo("juana@gmail.com.ar").email, "juana@gmail.com.ar", "fixDominioDeCorreo no toca .com.ar");

// Rescate en historial (más nuevo primero, primer hit).
const historial = [
  { content: "dale gracias" },
  { content: "" },
  ...Array.from({ length: 40 }, (_, i) => ({ content: `mensaje ${i}` })),
  { content: "te paso el comprobante, mi correo es vieja @ gmail.com" },
  { content: "antes: primera@gmail.com" },
];
check(findEmailInMessages(historial), "vieja@gmail.com", "historial largo: el más nuevo con correo (caption con espacios)");
check(findEmailInMessages([{ content: "hola" }, { content: null }]), null, "historial sin correo");

// Segundo correo: cuándo se pisa y cuándo no (D-72).
const dec = (current: string | null, incoming: string | null, accessInProgress: boolean) =>
  decideContactEmailUpdate({ current, incoming, accessInProgress });
check(dec(null, null, false), "ignore", "sin correo nuevo");
check(dec("juana@gmail.com", "JUANA@gmail.com ", true), "ignore", "mismo correo normalizado");
check(dec(null, "juana@gmail.com", false), "set", "primer correo");
check(dec(null, "juana@gmail.com", true), "set", "primer correo con pago validado");
check(dec("juana@gmial.com", "juana@gmail.com", false), "replace", "corrige antes del pago validado");
check(dec("juana@gmail.com", "juana.otra@hotmail.com", true), "keep_and_note", "segundo correo con pago validado o alta");
check(dec("basura@", "juana@gmail.com", true), "set", "el guardado no era válido");
check(dec("juana@gmail.com", "nombre@example.com", true), "ignore", "correo nuevo inválido");
const note = secondEmailNote("juana@gmail.com", "juana.otra@hotmail.com");
check(/juana\.otra@hotmail\.com/.test(note) && /juana@gmail\.com/.test(note) ? "ok" : note, "ok", "la nota nombra los dos correos");
check(/[.—]$/.test(note) ? note : "ok", "ok", "la nota no termina en punto ni lleva em dash");

console.log(fail === 0 ? "\nCONTACT EMAIL OK" : `\n${fail} TEST(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
