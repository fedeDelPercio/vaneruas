// Tests deterministas de captionLooksLikePayment.
//   npx tsx scripts/test-payment-signals.ts
import { captionLooksLikePayment } from "../src/lib/payments/signals";

let fail = 0;
function check(caption: string | null | undefined, expected: boolean, label: string) {
  const got = captionLooksLikePayment(caption);
  if (got === expected) {
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.error(`FAIL  ${label} -> esperaba ${expected}, dio ${got}`);
  }
}

// El caso real que rompió: caption de la captura de transferencia de Johanna.
check("GALLO JOHANNA ELIZABETH DNI 31010979 PAGO ENTRADA BLACK", true, "pago entrada black (caso real)");
check("Hola, ayer reserve la entrada, hoy transferi la seña", true, "reserva + transferi + seña");
check("te paso el comprobante", true, "comprobante");
check("ahi hice la transferencia", true, "transferencia");
check("aboné los $267.000", true, "abone + monto con $");
check("267.000 listo", true, "monto suelto 267.000");
check("ya pagué", true, "pague con acento");
check("me anoté en los cupos nuevos", true, "cupos");
check("quiero inscribirme", true, "inscribirme");

// Negativos: no deben gatillar el flujo de pago.
check("hola, una consulta", false, "saludo neutro");
check("[imagen]", false, "placeholder del canal");
check("", false, "vacío");
check(null, false, "null");
check("mil gracias", false, "agradecimiento");
check("a que hora abre?", false, "consulta de horario");

console.log(fail === 0 ? "\nPAYMENT SIGNALS OK" : `\n${fail} TEST(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
