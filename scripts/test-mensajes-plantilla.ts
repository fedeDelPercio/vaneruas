// Tests deterministas de los textos fijos de comprobante y acceso.
//   npx tsx scripts/test-mensajes-plantilla.ts
//
// Sin red: solo chequea que los textos salgan exactos, en una burbuja, y que
// el importador de mensajes del equipo los reconozca como nuestros.
import {
  COMPROBANTE_RECEIVED_MESSAGE,
  COMPROBANTE_RECEIVED_MESSAGE_LEGACY,
} from "../src/lib/payments/messages";
import { TEXTOS_DE_PLANTILLA, huella } from "../src/lib/providers/ghl-human";

let fail = 0;
function check(cond: boolean, label: string) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.error(`FAIL  ${label}`);
  }
}

const ESPERADO =
  "Genial, gracias por compartir el comprobante 🙌 El equipo lo revisa y te confirma la inscripción a la brevedad.\n\n⚠️ IMPORTANTE: Ahora revisamos manualmente tu solicitud. No hace falta que vuelvas a escribir, tranquila que no te vas a quedar sin tu lugar, podemos tener muchos mensajes pero no te vamos a dejar sin respuesta ♥️";

check(COMPROBANTE_RECEIVED_MESSAGE === ESPERADO, "comprobante: texto exacto");
// El worker parte en burbujas por líneas "---": este texto no tiene ninguna.
check(COMPROBANTE_RECEIVED_MESSAGE.split(/\n\s*---\s*\n/).length === 1, "comprobante: una sola burbuja");
check(COMPROBANTE_RECEIVED_MESSAGE.trim() === COMPROBANTE_RECEIVED_MESSAGE, "comprobante: el trim de la entrega no lo cambia");

// Importador del equipo: lo que vuelve de GHL (con o sin \r\n) se reconoce.
const huellas = new Set(TEXTOS_DE_PLANTILLA.map(huella));
check(huellas.has(huella(COMPROBANTE_RECEIVED_MESSAGE)), "importador: reconoce el texto nuevo");
check(huellas.has(huella(COMPROBANTE_RECEIVED_MESSAGE.replace(/\n/g, "\r\n"))), "importador: reconoce el texto nuevo con CRLF");
check(huellas.has(huella(COMPROBANTE_RECEIVED_MESSAGE_LEGACY)), "importador: reconoce el texto viejo");
check(!huellas.has(huella("Hola, te escribo del equipo por tu comprobante")), "importador: un mensaje del equipo no matchea");

console.log(fail === 0 ? "\nMENSAJES DE PLANTILLA OK" : `\n${fail} TEST(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
