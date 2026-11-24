import assert from "node:assert/strict";
import { cardDate, cardSteps, titleStep } from "../src/lib/payments/card-steps";

const now = Date.parse("2026-11-23T16:00:00Z");
const payment = {
  status: "pending" as const,
  titles: [],
  titleExempt: false,
  awaitingTitle: false,
  eventSlug: "masterclass-peelings-verano",
  createdAt: "2026-11-20T16:00:00Z",
  validatedAt: null,
  courseAccessGrantedAt: null,
  contactEmail: "alumna@fixtures.example.com",
};
const steps = (overrides: Partial<Parameters<typeof cardSteps>[0]> = {}) => cardSteps({ ...payment, ...overrides }, now);
const title = { hasFile: true, isValid: false, reviewedAt: null };

assert.deepEqual(steps().map(({ key }) => key), ["title", "receipt", "payment", "access"]);
assert.equal(steps()[0]!.detail, "No enviado");
assert.equal(steps()[1]!.detail, "Recibido el 20 nov");
assert.equal(steps()[1]!.status, "done");
assert.equal(steps()[2]!.detail, "Esperando aprobación del equipo");
assert.deepEqual(steps()[2]!.actions, ["approve", "reject"]);
assert.equal(steps()[3]!.detail, "Después de aprobar el pago");
assert.deepEqual(steps({ awaitingTitle: true }).map(({ status }) => status), ["current", "done", "future", "future"]);
assert.equal(steps({ awaitingTitle: true })[0]!.detail, "Esperando título");
assert.deepEqual(steps({ awaitingTitle: true })[0]!.actions, ["force"]);
assert.deepEqual(steps({ awaitingTitle: true })[2]!.actions, ["reject"]);
assert.equal(steps({ titleExempt: true })[0]!.detail, "Ya entregado · alumna registrada");
assert.equal(steps({ titleExempt: true })[0]!.status, "done");
assert.equal(steps({ titles: [title] })[0]!.detail, "En revisión");
assert.deepEqual(steps({ titles: [title], awaitingTitle: true })[0]!.actions, ["reviewTitle", "force"]);
assert.equal(steps({ titles: [{ ...title, reviewedAt: payment.createdAt }] })[0]!.detail, "Rechazado");
assert.equal(steps({ titles: [{ ...title, reviewedAt: payment.createdAt }] })[0]!.status, "error");
for (const [reviewedAt, detail] of [
  ["2026-11-23T03:00:00Z", "Validado hoy"],
  ["2026-11-23T02:59:59Z", "Validado ayer"],
  [payment.createdAt, "Validado el 20 nov"],
  [null, "Validado"],
] as const) {
  assert.equal(steps({ titles: [{ ...title, isValid: true, reviewedAt }] })[0]!.detail, detail);
}
const approved = { status: "validated" as const, validatedAt: "2026-11-23T16:00:00Z" };
assert.equal(steps(approved)[2]!.detail, "Aprobado el 23 nov");
assert.equal(steps(approved)[3]!.status, "current");
assert.deepEqual(steps(approved)[3]!.actions, ["grant", "mark"]);
assert.equal(steps({ ...approved, courseAccessQueued: true })[3]!.detail, "En cola, se reintenta solo");
assert.equal(steps({ ...approved, contactEmail: null })[3]!.detail, "Falta el mail");
assert.deepEqual(steps({ ...approved, contactEmail: "" })[3]!.actions, ["email", "mark"]);
assert.equal(steps({ ...approved, courseAccessGrantedAt: approved.validatedAt })[3]!.detail, "Dado el 23 nov");
assert.equal(steps({ ...approved, courseAccessGrantedAt: approved.validatedAt })[3]!.status, "done");
const rejected = steps({ status: "rejected", courseAccessGrantedAt: approved.validatedAt });
assert.equal(rejected[2]!.detail, "Rechazado");
assert.equal(rejected[2]!.status, "error");
assert.equal(rejected[3]!.status, "future");
assert.equal(rejected[3]!.actions, undefined);
assert.equal(steps({ eventSlug: "congreso" }).length, 3);
assert.equal(steps({ eventSlug: null }).length, 3);
assert.equal(titleStep("review", { now, historical: true }).status, "future");
assert.equal(titleStep("rejected", { now, historical: true }).detail, "Sin registro para este evento");
assert.equal(titleStep("exempt", { now, historical: true }).status, "done");
assert.equal(cardDate("2026-12-02"), "2 dic");
assert.equal(cardDate("invalid"), "");
console.log("Estados del stepper de pagos y del título en la ficha: OK");
