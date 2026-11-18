// Tests deterministas de cuándo se pide el correo (BUG 3, 18/11/2026).
//   npx tsx scripts/test-email-ask.ts
//
// Sin red. Regla: el correo se pide SOLO con todo aprobado (pago verificado y
// título si hacía falta), en el mismo mensaje de la aprobación, y una sola vez
// por pago.
import {
  approvalMessage,
  emailAskState,
  emailContextLine,
  isEmailAsk,
  titleValidatedMessage,
} from "../src/lib/payments/email-ask";
import {
  EMAIL_REQUEST_MESSAGE,
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
  PAYMENT_APPROVED_MESSAGE,
  TITLE_VALIDATED_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_PAYMENT_OK_MESSAGE,
} from "../src/lib/payments/messages";
import { TEXTOS_DE_PLANTILLA, huella } from "../src/lib/providers/ghl-human";
import { readFileSync } from "fs";
import { join } from "path";

let fail = 0;
function check(cond: boolean, label: string) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.error(`FAIL  ${label}`);
  }
}

// --- Textos ------------------------------------------------------------------
check(
  PAYMENT_APPROVED_MESSAGE ===
    "Buenísimo, tu pago quedó verificado ✅ En breve te enviamos el acceso a tu correo, cualquier cosa quedamos en contacto 🙌🏻",
  "aprobado: texto de siempre intacto",
);
check(
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE.startsWith("Buenísimo, tu pago quedó verificado ✅") &&
    PAYMENT_APPROVED_ASK_EMAIL_MESSAGE.includes("me pasás el correo con el que te inscribiste en la web"),
  "aprobado sin correo: confirma el pago y pide el correo en el mismo mensaje",
);
for (const [name, t] of [
  ["aprobado", PAYMENT_APPROVED_MESSAGE],
  ["aprobado+correo", PAYMENT_APPROVED_ASK_EMAIL_MESSAGE],
  ["título+correo", TITLE_VALIDATED_ASK_EMAIL_MESSAGE],
  ["título+pago ok", TITLE_VALIDATED_PAYMENT_OK_MESSAGE],
] as const) {
  check(t.split(/\n\s*---\s*\n/).length === 1, `${name}: una sola burbuja`);
  check(!/[.]$/.test(t.trim()) && !t.includes("—") && !/[¿¡]/.test(t), `${name}: sin punto final, em dash ni ¿¡`);
  check(!t.includes("**"), `${name}: sin negrita`);
}

// --- Mensaje de aprobación ----------------------------------------------------
check(
  approvalMessage({ hasEmail: true, alreadyAsked: false }).content === PAYMENT_APPROVED_MESSAGE,
  "con correo: confirmación de siempre",
);
const sinCorreo = approvalMessage({ hasEmail: false, alreadyAsked: false });
check(
  sinCorreo.content === PAYMENT_APPROVED_ASK_EMAIL_MESSAGE && sinCorreo.asksEmail,
  "sin correo: UN mensaje que confirma y pide el correo",
);
check(
  approvalMessage({ hasEmail: false, alreadyAsked: true }).content === PAYMENT_APPROVED_MESSAGE,
  "sin correo pero ya se lo pedimos por este pago: no se repite el pedido",
);

// --- Título validado después del pago -----------------------------------------
check(
  titleValidatedMessage({ paymentValidated: false, hasEmail: false, alreadyAsked: false }) === null,
  "título sin pago verificado: no pide el correo (mensaje de siempre)",
);
check(
  titleValidatedMessage({ paymentValidated: true, hasEmail: false, alreadyAsked: false }) ===
    TITLE_VALIDATED_ASK_EMAIL_MESSAGE,
  "título con pago ya verificado y sin correo: lo pide en el mismo mensaje",
);
check(
  titleValidatedMessage({ paymentValidated: true, hasEmail: false, alreadyAsked: true }) ===
    TITLE_VALIDATED_PAYMENT_OK_MESSAGE,
  "título con pago verificado, correo ya pedido: no lo repite",
);
check(
  titleValidatedMessage({ paymentValidated: true, hasEmail: true, alreadyAsked: false }) ===
    TITLE_VALIDATED_PAYMENT_OK_MESSAGE,
  "título con pago verificado y correo: no lo pide",
);

// --- Idempotencia: todos los pedidos cuentan como "ya se lo pedimos" -----------
check(isEmailAsk(PAYMENT_APPROVED_ASK_EMAIL_MESSAGE), "pedido: aprobación con correo");
check(isEmailAsk(TITLE_VALIDATED_ASK_EMAIL_MESSAGE), "pedido: título con correo");
check(isEmailAsk(EMAIL_REQUEST_MESSAGE), "pedido: el suelto viejo también cuenta");
check(!isEmailAsk(PAYMENT_APPROVED_MESSAGE), "la confirmación de siempre no es un pedido");

// --- Contexto del agente --------------------------------------------------------
check(
  emailAskState({ hasEmail: false, hasPayment: false, hasApprovedPayment: false }) === "sin_pagos" &&
    emailContextLine("sin_pagos") === "",
  "sin comprobantes: no se dice nada",
);
check(
  emailAskState({ hasEmail: false, hasPayment: true, hasApprovedPayment: false }) === "todavia_no",
  "comprobante en revisión (o retenido por título) sin correo: NO todavía",
);
check(
  emailAskState({ hasEmail: false, hasPayment: true, hasApprovedPayment: true }) === "pedir",
  "pago verificado sin correo: pedir",
);
check(
  emailAskState({ hasEmail: true, hasPayment: true, hasApprovedPayment: true }) === "ya_tenemos",
  "con correo: no pedir",
);
check(/NO todavía/.test(emailContextLine("todavia_no")), "línea 'todavía no' explícita");
check(/agradecele/.test(emailContextLine("todavia_no")), "si lo ofrece igual, se acepta");
check(/SÍ/.test(emailContextLine("pedir")), "línea 'pedir' explícita");

// --- Ya no se pide al recibir comprobante ni título (chequeo estático) ---------
for (const f of ["src/lib/payments/register.ts", "src/lib/titles/handle.ts"]) {
  const src = readFileSync(join(__dirname, "..", f), "utf8");
  check(
    !/EMAIL_REQUEST_MESSAGE|askEmailIfMissing/.test(src),
    `${f}: no manda el pedido de correo suelto`,
  );
}

// --- Importador del equipo ------------------------------------------------------
const huellas = new Set(TEXTOS_DE_PLANTILLA.map(huella));
for (const t of [
  PAYMENT_APPROVED_MESSAGE,
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_ASK_EMAIL_MESSAGE,
  TITLE_VALIDATED_PAYMENT_OK_MESSAGE,
  EMAIL_REQUEST_MESSAGE,
]) {
  check(huellas.has(huella(t)), `importador reconoce: ${t.slice(0, 40)}…`);
}

console.log(fail === 0 ? "\nPEDIDO DE CORREO OK" : `\n${fail} TEST(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
