import assert from "node:assert/strict";
import { DISMISS_NOTE } from "../src/lib/payments/dismiss";
import {
  eventTitle, needsCourseAccess, paymentStatusChip, previousMasterclasses, titleDelivered, titleState,
} from "../src/lib/payments/revision-card";

const peelings = "masterclass-peelings-verano";
const higiene = "masterclass-higiene-facial-dermaplaning";
assert.equal(eventTitle(peelings), "Peelings de Verano Masterizado");
assert.equal(eventTitle("desconocido"), null);
assert.equal(paymentStatusChip.validated.label, "Aprobado");
assert.equal(needsCourseAccess(peelings, "validated", null), true);
assert.equal(needsCourseAccess(peelings, "validated", "2026-11-23"), false);
assert.equal(needsCourseAccess(peelings, "pending", null), false);
assert.equal(needsCourseAccess(higiene, "validated", null), false);

const pending = { hasFile: true, isValid: false, reviewedAt: null };
const rejected = { ...pending, reviewedAt: "2026-11-23" };
assert.equal(titleState([], false), "none");
assert.equal(titleState([], true), "exempt");
assert.equal(titleState([pending], true), "review");
assert.equal(titleState([rejected], false), "rejected");
assert.equal(titleState([rejected, pending], false), "review");
assert.equal(titleState([rejected, pending, { ...pending, isValid: true }], false), "valid");
assert.equal(titleDelivered([rejected], false), true);
assert.equal(titleDelivered([{ ...pending, hasFile: false }], false), false);
assert.equal(titleDelivered([], true), true);

const current = {
  id: "actual",
  event_slug: peelings,
  created_at: "2026-11-23T15:00:00Z",
  transferred_at: null as string | null,
  validation_note: null as string | null,
  operation_number: "ABC" as string | null,
  status: "validated",
};
const history = [
  current,
  { ...current, id: "higiene", event_slug: higiene, operation_number: "XYZ", transferred_at: "2026-06-01T00:10:00Z" },
  { ...current, id: "duplicado histórico", event_slug: higiene, operation_number: "xyz", transferred_at: "2026-08-03T12:00:00Z" },
  { ...current, id: "anterior", operation_number: null, created_at: "2026-10-15T12:00:00Z" },
  { ...current, id: "posterior", operation_number: null, created_at: "2026-12-15T12:00:00Z" },
  { ...current, id: "agrupado", operation_number: null, event_slug: higiene },
  { ...current, id: "duplicado", operation_number: " abc ", event_slug: higiene },
  { ...current, id: "descartado", operation_number: null, event_slug: higiene, validation_note: DISMISS_NOTE },
  { ...current, id: "rechazado", operation_number: null, event_slug: higiene, status: "rejected" },
];
assert.deepEqual(previousMasterclasses(current, history, new Set(["agrupado"])), [
  "PEELINGS · OCT 2026",
  "HIGIENE FACIAL · JUN 2026",
]);
console.log("Tarjeta de revisión: estados, título, acceso e historial correctos");
