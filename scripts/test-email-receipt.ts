// Tests deterministas del pedido de correo al recibir el comprobante, correo
// incompleto y compra nueva (22/11/2026). Datos sintéticos.
//   npx tsx scripts/test-email-receipt.ts
import {
  approvalMessage,
  emailAskOnReceiptEnabled,
  emailAskState,
  emailContextLine,
  hasDeliveredEmailAsk,
  incompleteEmailContextLine,
  isEmailAsk,
  looksLikeEmailAsk,
  pendingIncompleteEmail,
  receiptMessage,
  titleWithComprobanteMessage,
  wasDelivered,
} from "../src/lib/payments/email-ask";
import {
  decideContactEmailUpdate,
  findIncompleteEmail,
  newPurchaseEmailNote,
  type NewPurchaseContext,
} from "../src/lib/contact-email";
import {
  COMPROBANTE_RECEIVED_ASK_EMAIL_MESSAGE as ASK,
  COMPROBANTE_RECEIVED_MESSAGE as PLAIN,
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
  PAYMENT_APPROVED_MESSAGE,
  TITLE_VALIDATED_COMPROBANTE_ASK_EMAIL_MESSAGE as TITLE_ASK,
  TITLE_VALIDATED_COMPROBANTE_MESSAGE as TITLE_PLAIN,
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

// --- Flag ---------------------------------------------------------------------
for (const v of ["false", "0", "off", "no", " OFF "]) check(!emailAskOnReceiptEnabled(v), `flag apagado: "${v}"`);
for (const v of [undefined, null, "", "true", "1"]) check(emailAskOnReceiptEnabled(v), `flag prendido: ${String(v)}`);

// --- Comprobante ---------------------------------------------------------------
check(receiptMessage({ hasEmail: false, alreadyAsked: false, askOnReceipt: true }).content === ASK, "sin correo: pide");
check(receiptMessage({ hasEmail: false, alreadyAsked: false, askOnReceipt: false }).content === PLAIN, "flag apagado: texto de siempre");
check(receiptMessage({ hasEmail: false, alreadyAsked: true, askOnReceipt: true }).content === PLAIN, "ya pedido: no repite");
check(receiptMessage({ hasEmail: true, alreadyAsked: false, askOnReceipt: true }).content === PLAIN, "con correo: no pide");
check(titleWithComprobanteMessage({ hasEmail: false, alreadyAsked: false, askOnReceipt: true }) === TITLE_ASK, "título: pide");
check(titleWithComprobanteMessage({ hasEmail: false, alreadyAsked: true, askOnReceipt: true }) === TITLE_PLAIN, "título: ya pedido");
check(titleWithComprobanteMessage({ hasEmail: false, alreadyAsked: false, askOnReceipt: false }) === TITLE_PLAIN, "título: flag apagado");
for (const [n, t] of [["comprobante", ASK], ["título", TITLE_ASK]] as const) {
  check(t.split(/\n\s*---\s*\n/).length === 1, `${n}: una burbuja`);
  check(!t.includes("—") && !/[¿¡]/.test(t) && !t.includes("**"), `${n}: sin em dash, ¿¡ ni negrita`);
  check(isEmailAsk(t), `${n}: cuenta como pedido`);
  check(TEXTOS_DE_PLANTILLA.map(huella).includes(huella(t)), `${n}: lo reconoce el importador`);
}
check(!/No hace falta que vuelvas a escribir/.test(ASK), "no pide el correo y dice que no hace falta escribir");

// --- Aprobación después del pedido ----------------------------------------------
const delivered = { content: ASK, external_id: "ghl-1", delivered_at: null };
const failed = { content: ASK, external_id: null, delivered_at: null };
check(
  approvalMessage({ hasEmail: false, alreadyAsked: hasDeliveredEmailAsk([delivered], "whatsapp") }).content === PAYMENT_APPROVED_MESSAGE,
  "aprobación tras pedido entregado: no pide dos veces",
);
check(
  approvalMessage({ hasEmail: false, alreadyAsked: hasDeliveredEmailAsk([failed], "whatsapp") }).content === PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
  "aprobación tras pedido fallido: lo pide",
);

// --- Entrega --------------------------------------------------------------------
check(wasDelivered({ external_id: "x", delivered_at: null }, "whatsapp"), "entregado por id de GHL");
check(wasDelivered({ external_id: null, delivered_at: "2026-11-22T00:00:00Z" }, "whatsapp"), "entregado por delivered_at");
check(!wasDelivered({ external_id: null, delivered_at: null }, "whatsapp"), "sin marcas: no entregado");
check(wasDelivered({ external_id: null, delivered_at: null }, "test"), "panel de prueba: entregado");
check(!hasDeliveredEmailAsk([failed], "whatsapp"), "pedido fallido no cuenta");
check(!hasDeliveredEmailAsk([{ content: PLAIN, external_id: "x", delivered_at: null }], "whatsapp"), "la confirmación no es pedido");

// --- Pedidos redactados por el agente -------------------------------------------
check(looksLikeEmailAsk("Me pasás tu correo así te mando el acceso?"), "agente: me pasás tu correo");
check(looksLikeEmailAsk("Reenviame el mail completo porfa"), "agente: reenviame el mail");
check(!looksLikeEmailAsk(PAYMENT_APPROVED_MESSAGE), "'te enviamos el acceso a tu correo' no es pedido");
check(!looksLikeEmailAsk("Buenísimo, queda registrado tu correo 🙌"), "confirmar el correo no es pedido");

// --- Estado del agente ----------------------------------------------------------
const st = (o: Partial<Parameters<typeof emailAskState>[0]>) =>
  emailAskState({ hasEmail: false, hasPayment: true, hasApprovedPayment: false, askOnReceipt: true, ...o });
check(st({ hasPaymentInReview: true }) === "pedir_en_revision", "en revisión sin correo: pedir");
check(st({ hasPaymentInReview: true, alreadyAsked: true }) === "ya_pedido", "en revisión, ya pedido: no insistir");
check(st({ hasPaymentInReview: true, askOnReceipt: false }) === "todavia_no", "flag apagado: todavía no");
check(st({ hasPaymentInReview: true, awaitingTitle: true }) === "todavia_no", "falta título: primero el título");
check(st({}) === "todavia_no", "nada en revisión: no pide");
check(st({ hasApprovedPayment: true }) === "pedir", "validado sin correo: pedir");
check(st({ hasApprovedPayment: true, alreadyAsked: true }) === "ya_pedido", "validado ya pedido: no repite");
check(st({ hasEmail: true, hasPaymentInReview: true }) === "ya_tenemos", "con correo: no pide");
check(/SÍ, en esta respuesta/.test(emailContextLine("pedir_en_revision")), "línea: pedir en la respuesta");
check(/No insistas/.test(emailContextLine("ya_pedido")), "línea: no insistir");

// --- Correo incompleto ----------------------------------------------------------
for (const t of ["abcdef1234@gmail.", "Nombre Apellido\nabcdef1234@gmail.\nEntrenadora de estética", "x@gmail", "x@ gmail", "nombre@hotmail .", "nombre@", "mi correo es nombre @gmail"]) {
  check(findIncompleteEmail(t) !== null, `incompleto: ${t}`);
}
for (const t of ["juana@gmail.com", "juana @ gmail . com", "@usuario", "seguime en ig @usuario", "hola @usuario", "sin arroba", "nombre@example.com", "hola@ como estas", "Nombre\njuana@gmail.com\nEntrenadora"]) {
  check(findIncompleteEmail(t) === null, `no incompleto: ${t}`);
}
const masked = findIncompleteEmail("abcdef1234@gmail.")!;
check(masked === "a***@gmail." && !masked.includes("bcdef"), "se enmascara la parte local");
check(incompleteEmailContextLine(masked).includes("reenvíe completo"), "línea: pedir reenviarlo completo");
const row = (role: string, content: string, ext: string | null = "g") => ({ role, content, external_id: ext, delivered_at: null });
check(pendingIncompleteEmail({ turnMessage: "x@gmail", history: [], source: "whatsapp" }) !== null, "incompleto en el turno");
check(pendingIncompleteEmail({ turnMessage: "hola", history: [row("user", "x@gmail")], source: "whatsapp" }) !== null, "incompleto en el historial");
check(
  pendingIncompleteEmail({ turnMessage: "hola", history: [row("assistant", "Me reenviás el correo completo?"), row("user", "x@gmail")], source: "whatsapp" }) === null,
  "ya se pidió reenviarlo: no repite",
);
check(
  pendingIncompleteEmail({ turnMessage: "hola", history: [row("assistant", "Me reenviás el correo completo?", null), row("user", "x@gmail")], source: "whatsapp" }) !== null,
  "el pedido de reenvío no se entregó: sigue pendiente",
);

// --- Compra nueva -----------------------------------------------------------------
const OLD = "vieja@gmail.com";
const NEW = "nueva@gmail.com";
const base: NewPurchaseContext = {
  periodStartIso: "2026-11-20T21:11:00Z",
  incomingAtIso: "2026-11-20T21:10:00Z",
  storedFirstSeenAtIso: "2026-07-18T12:00:00Z",
  periodAccessGranted: false,
  otherEventAwaitingAccess: false,
  teamCorrectedInPeriod: false,
};
const dec = (p: Partial<NewPurchaseContext> | null) =>
  decideContactEmailUpdate({ current: OLD, incoming: NEW, accessInProgress: true, purchase: p ? { ...base, ...p } : null });
check(dec({}) === "replace", "vuelve con otro correo justo antes del comprobante: pisa");
check(dec({ incomingAtIso: "2026-11-20T22:00:00Z" }) === "replace", "correo después del comprobante: pisa");
check(dec({ storedFirstSeenAtIso: null }) === "replace", "guardado nunca escrito en el chat: pisa");
check(dec({ storedFirstSeenAtIso: "2026-11-20T21:05:00Z" }) === "keep_and_note", "mismo período: keep_and_note");
check(dec({ incomingAtIso: "2026-11-20T10:00:00Z" }) === "keep_and_note", "correo nuevo anterior al período: keep_and_note");
check(dec({ periodAccessGranted: true }) === "keep_and_note", "esta compra ya tiene acceso: keep_and_note");
check(dec({ otherEventAwaitingAccess: true }) === "keep_and_note", "otro evento espera acceso: keep_and_note");
check(dec({ teamCorrectedInPeriod: true }) === "keep_and_note", "corregido por el equipo: keep_and_note");
check(dec(null) === "keep_and_note", "sin datos de la compra: keep_and_note");
const note = newPurchaseEmailNote(OLD, NEW);
check(note === `Correo actualizado para esta inscripción: ${OLD} → ${NEW}`, "nota de reemplazo");

console.log(fail === 0 ? "\nPEDIDO AL RECIBIR OK" : `\n${fail} TEST(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
