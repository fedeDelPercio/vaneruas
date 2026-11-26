// Cupos adicionales de Peelings: plazos antes/después de las 23:00, asignación
// del slug por fecha de llegada, sin alta Tiendup ni cola, stepper y mensajes.
import assert from "node:assert/strict";
import { plazosBlock, plazosResueltos } from "../src/lib/agent/plazos";
import { MP_LINK, PAYPAL_LINK, TRANSFER_ALIAS, TRANSFER_TITULAR } from "../src/lib/agent/extension-cupos";
import {
  EXTENSION_EVENT_SLUG, accesoVigenteDeEvento, esEventoSinTiendup, matchEventByAmount, resolveStoredEventSlug,
} from "../src/lib/payments/event-match";
import { needsCourseAccess } from "../src/lib/payments/revision-card";
import { SIN_TIENDUP_LABEL, cardSteps } from "../src/lib/payments/card-steps";
import { approvalMessage, extensionContextLine, receiptMessage, titleValidatedMessage, titleWithComprobanteMessage } from "../src/lib/payments/email-ask";
import * as messages from "../src/lib/payments/messages";
import { decideRetry } from "../src/lib/tiendup/retry-policy";

const at = (iso: string) => new Date(iso);
const antes = at("2026-11-25T22:59:59-03:00");
const despues = at("2026-11-25T23:00:00-03:00");
const peelings = "masterclass-peelings-verano";

// --- Plazos: corte 23:00
const pre = plazosBlock(antes);
assert.match(pre, /ABIERTAS/);
assert.match(pre, /23 hs/);
assert.match(pre, /REEMPLAZA al "21 hs"/);
assert.doesNotMatch(pre, /CUPOS ADICIONALES/);
const post = plazosBlock(despues);
assert.match(post, /CUPOS ADICIONALES/);
assert.match(post, /PRIORIDAD ABSOLUTA/);
assert.match(post, /\$110\.000/);
assert.match(post, /\$150\.000, hasta en 3 cuotas sin interés/);
assert.match(post, /USD 90/);
assert.ok(post.includes(MP_LINK) && post.includes(PAYPAL_LINK));
assert.match(post, /comprobante junto con tu nombre y apellido, tu correo electrónico y tu título profesional/);
assert.ok(post.includes(TRANSFER_ALIAS) && post.includes(TRANSFER_TITULAR));
assert.match(post, /Alias: nueva\.piel/);
assert.match(post, /Titular: Vanesa Cintia Ruas/);
assert.match(post, /SÍ das el alias y el titular/);
assert.match(post, /NO derives por eso/);
assert.match(post, /CBU y CUIT: seguís SIN darlos/);
assert.match(post, /no se activa por Tiendup|NO se activa por Tiendup/);
// Antes del corte el alias NO aparece: la excepción es solo desde las 23:00.
assert.doesNotMatch(pre, /nueva\.piel|Cintia/i);
assert.equal(TRANSFER_ALIAS, "nueva.piel");
assert.equal(TRANSFER_TITULAR, "Vanesa Cintia Ruas");
// A las 21:00 ya no cierra: sigue abierta.
assert.match(plazosBlock(at("2026-11-25T21:30:00-03:00")), /ABIERTAS/);
assert.doesNotMatch(plazosBlock(at("2026-11-25T21:30:00-03:00")), /CUPOS ADICIONALES/);
// El resto de los plazos sigue ahí.
assert.equal(plazosResueltos(at("2026-11-29T10:00:00-03:00")).some((l) => l.includes("YA SE DICTÓ")), true);

// --- Asignación del slug por fecha de llegada del comprobante
assert.equal(resolveStoredEventSlug(110000, antes), peelings);
assert.equal(resolveStoredEventSlug(110000, despues), EXTENSION_EVENT_SLUG);
assert.equal(resolveStoredEventSlug(null, antes), peelings);
assert.equal(resolveStoredEventSlug(null, despues), EXTENSION_EVENT_SLUG);
assert.equal(resolveStoredEventSlug(150000, despues), EXTENSION_EVENT_SLUG);
assert.equal(resolveStoredEventSlug(150000, antes), peelings);
assert.equal(resolveStoredEventSlug(110000, at("2026-11-26T09:00:00-03:00").getTime()), EXTENSION_EVENT_SLUG);
// Los otros eventos no cambian después del corte.
assert.equal(resolveStoredEventSlug(267000, despues), "congreso");
assert.equal(resolveStoredEventSlug(105000, despues), "masterclass-higiene-facial-dermaplaning");
// El evento hermano no se identifica por monto.
assert.equal(matchEventByAmount(0), null);
assert.equal(matchEventByAmount(110000)?.slug, peelings);

// --- Sin alta Tiendup: ni auto-alta ni cola ni "Falta acceso"
assert.equal(accesoVigenteDeEvento(EXTENSION_EVENT_SLUG), false);
assert.equal(esEventoSinTiendup(EXTENSION_EVENT_SLUG), true);
assert.equal(esEventoSinTiendup(peelings), false);
assert.equal(accesoVigenteDeEvento(peelings), true);
assert.equal(needsCourseAccess(EXTENSION_EVENT_SLUG, "validated", null), false);
assert.equal(needsCourseAccess(peelings, "validated", null), true);
// Mismo criterio que waitsForAccess (auto-enroll.ts, server-only): sin título retenido + needsCourseAccess.
const waitsForAccess = (r: { awaiting_title: boolean; event_slug: string | null; status: string; course_access_granted_at: string | null }) =>
  !r.awaiting_title && needsCourseAccess(r.event_slug, r.status, r.course_access_granted_at);
const row = (slug: string) => ({
  id: "p1", conversation_id: "c1", event_slug: slug, status: "validated", awaiting_title: false,
  course_access_granted_at: null, course_access_error: null,
});
assert.equal(waitsForAccess(row(EXTENSION_EVENT_SLUG)), false);
assert.equal(waitsForAccess(row(peelings)), true);
const now = Date.now();
const retryRow = (slug: string) => ({
  ...row(slug), updated_at: new Date(now).toISOString(), created_at: new Date(now - 3_600_000).toISOString(),
});
assert.equal(decideRetry({ row: retryRow(EXTENSION_EVENT_SLUG), now, waitsForAccess: waitsForAccess(row(EXTENSION_EVENT_SLUG)), hasValidEmail: true }).action, "skip");

// --- Stepper: paso Acceso "Sin alta Tiendup (cupo adicional)", sin acciones
const pay = (over: object) => ({
  status: "validated" as const, titles: [], titleExempt: true, awaitingTitle: false,
  createdAt: "2026-11-25T23:10:00-03:00", validatedAt: "2026-11-25T23:30:00-03:00",
  eventSlug: EXTENSION_EVENT_SLUG, courseAccessGrantedAt: null, contactEmail: null, ...over,
});
for (const over of [{}, { status: "pending", validatedAt: null }, { contactEmail: "a@b.co" }, { status: "rejected" }]) {
  const access = cardSteps(pay(over) as never, now).find((s) => s.key === "access")!;
  assert.equal(access.detail, SIN_TIENDUP_LABEL);
  assert.equal(access.status, "future");
  assert.equal(access.actions, undefined);
}
assert.equal(SIN_TIENDUP_LABEL, "Sin alta Tiendup (cupo adicional)");
// La venta normal sigue igual.
const normal = cardSteps(pay({ eventSlug: peelings }) as never, now).find((s) => s.key === "access")!;
assert.equal(normal.detail, "Falta el mail");
assert.deepEqual(normal.actions, ["email", "mark"]);

// --- Mensajes del evento hermano: una constante, sin Tiendup/web/acceso por correo
const E = messages.EXTENSION_PAYMENT_APPROVED_MESSAGE;
assert.match(E, /Tu pago fue verificado y tu lugar quedó confirmado/);
assert.doesNotMatch(E, /tiendup|web|correo|mail/i);
for (const hasEmail of [true, false]) {
  for (const alreadyAsked of [true, false]) {
    assert.deepEqual(approvalMessage({ hasEmail, alreadyAsked, extension: true }), { content: E, asksEmail: false });
    assert.equal(titleValidatedMessage({ paymentValidated: true, hasEmail, alreadyAsked, extension: true }), E);
    assert.equal(receiptMessage({ hasEmail, alreadyAsked, askOnReceipt: true, extension: true }).content, messages.COMPROBANTE_RECEIVED_MESSAGE);
    assert.equal(titleWithComprobanteMessage({ hasEmail, alreadyAsked, askOnReceipt: true, extension: true }), messages.TITLE_VALIDATED_COMPROBANTE_MESSAGE);
  }
}
// Sin la marca, la venta normal sigue igual.
assert.equal(approvalMessage({ hasEmail: false, alreadyAsked: false }).content, messages.PAYMENT_APPROVED_ASK_EMAIL_MESSAGE);
assert.equal(approvalMessage({ hasEmail: true, alreadyAsked: false }).content, messages.PAYMENT_APPROVED_MESSAGE);
assert.equal(receiptMessage({ hasEmail: false, alreadyAsked: false, askOnReceipt: true }).asksEmail, true);

// --- Contexto del agente para un comprobante de cupo adicional
const sinMail = extensionContextLine({ hasEmail: false, awaitingTitle: true });
assert.match(sinMail, /falta: el correo electrónico y el título profesional/i);
assert.match(sinMail, /No hables de "el correo con el que te inscribiste en la web"/);
assert.doesNotMatch(sinMail, /Pedir correo: SÍ/);
const completo = extensionContextLine({ hasEmail: true, awaitingTitle: false });
assert.match(completo, /no los pidas de nuevo/);
assert.match(completo, /el equipo revisa la inscripción/);

console.log("Cupos adicionales: plazos 23:00, slug por fecha, sin Tiendup, stepper y mensajes OK");
