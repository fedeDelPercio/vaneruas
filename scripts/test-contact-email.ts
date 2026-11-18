// Tests deterministas de la extracción y validación del correo de la contacta.
//   npx tsx scripts/test-contact-email.ts
import {
  decideContactEmailUpdate,
  extractContactEmail,
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
