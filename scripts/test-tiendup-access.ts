// Tests sin red de las dos líneas del bloque Tiendup (mail vs. acceso a la
// inscripción actual).  npx tsx scripts/test-tiendup-access.ts
import { decideCurrentAccess, decideMailStatus, pickEnrollablePayment } from "../src/lib/tiendup/status";
import { manualEmailNote } from "../src/lib/tiendup/messages";

let fail = 0;
function check(got: unknown, expected: unknown, label: string) {
  const g = JSON.stringify(got);
  const e = JSON.stringify(expected);
  if (g === e) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.error(`FAIL  ${label} -> esperaba ${e}, dio ${g}`);
  }
}

// Caso Federico: inscripta en Dermaplaning, pagó Peelings.
const perCourse = [
  { title: "Dermaplaning", state: "enrolled" as const },
  { title: "Peelings", state: "customer_not_enrolled" as const },
];
check(
  decideMailStatus({ perCourse, isCustomer: null, customersComplete: false, notInMarker: false }),
  { state: "has_courses", courses: ["Dermaplaning"] },
  "mail validado: ya tiene otros cursos",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 554178, courseState: { state: "customer_not_enrolled" }, listingComplete: true }),
  { state: "pending" },
  "Peelings aprobado sin alta: pendiente, aunque figure en otro curso",
);
check(
  decideCurrentAccess({ paymentStatus: "pending", granted: false, courseId: 554178, courseState: { state: "customer_not_enrolled" }, listingComplete: true }),
  { state: "awaiting_approval" },
  "Peelings con pago sin aprobar",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 554178, courseState: { state: "enrolled" }, listingComplete: true }),
  { state: "enrolled" },
  "figura en el curso del evento actual",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: true, courseId: 554178, courseState: { state: "unavailable" }, listingComplete: false }),
  { state: "granted" },
  "alta exitosa sin poder releer",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: true, courseId: 554178, courseState: { state: "customer_not_enrolled" }, listingComplete: true }),
  { state: "granted_missing" },
  "alta marcada pero no figura",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: null, courseState: null, listingComplete: false }),
  { state: "no_mapping" },
  "evento sin curso mapeado",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 1, courseState: { state: "error", error: "500" }, listingComplete: true }),
  { state: "error", error: "500" },
  "error del alta",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 1, courseState: { state: "not_found" }, listingComplete: true }),
  { state: "not_found" },
  "alta frenada: mail no figura",
);
check(
  decideMailStatus({ perCourse: [{ title: "A", state: "not_found" }], isCustomer: false, customersComplete: true, notInMarker: false }),
  { state: "not_found", courses: [] },
  "mail no figura",
);
check(
  decideMailStatus({ perCourse: [{ title: "A", state: "unavailable" }], isCustomer: true, customersComplete: false, notInMarker: false }),
  { state: "customer_no_courses", courses: [] },
  "cliente sin cursos",
);
check(
  decideMailStatus({ perCourse: [{ title: "A", state: "other_email", otherEmailMasked: "ma***@gm***.com" }], isCustomer: false, customersComplete: true, notInMarker: false }),
  { state: "other_email", courses: [], otherEmailMasked: "ma***@gm***.com" },
  "mismo nombre otro mail",
);
check(
  decideMailStatus({ perCourse: [{ title: "A", state: "unavailable" }], isCustomer: null, customersComplete: false, notInMarker: false }),
  { state: "unavailable", courses: [] },
  "sin datos",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 1, courseState: { state: "unavailable" }, listingComplete: true }),
  { state: "pending" },
  "curso completo sin clientes consultados: pendiente",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 1, courseState: { state: "unavailable" }, listingComplete: false }),
  { state: "unavailable" },
  "curso sin listado: no se afirma",
);
// Sin mail guardado (status-server): la línea del acceso sale de lo guardado.
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 554178, courseState: { state: "unavailable" }, listingComplete: true }),
  { state: "pending" },
  "sin mail: aprobado sin alta → pendiente",
);
check(
  decideCurrentAccess({ paymentStatus: "validated", granted: true, courseId: 554178, courseState: { state: "unavailable" }, listingComplete: false }),
  { state: "granted" },
  "sin mail: alta ya marcada → enviado",
);
check(
  decideCurrentAccess({ paymentStatus: "pending", granted: false, courseId: 554178, courseState: { state: "unavailable" }, listingComplete: true }),
  { state: "awaiting_approval" },
  "sin mail: pago sin aprobar",
);

// Pago al que se da el alta desde la ficha.
const mapped = (slug: string | null) => slug === "masterclass-peelings-verano" || slug === "masterclass-higiene-facial-dermaplaning";
const pays = [
  { id: "a", status: "validated", event_slug: "masterclass-higiene-facial-dermaplaning", created_at: "2026-10-01T10:00:00Z", validation_note: null },
  { id: "b", status: "validated", event_slug: "masterclass-peelings-verano", created_at: "2026-11-18T10:00:00Z", validation_note: null },
  { id: "c", status: "pending", event_slug: "masterclass-peelings-verano", created_at: "2026-11-19T10:00:00Z", validation_note: null },
  { id: "d", status: "validated", event_slug: "congreso", created_at: "2026-11-20T10:00:00Z", validation_note: null },
  { id: "e", status: "rejected", event_slug: "masterclass-peelings-verano", created_at: "2026-11-20T11:00:00Z", validation_note: "Agrupado con el comprobante b" },
];
check(pickEnrollablePayment(pays, mapped)?.id ?? null, "b", "el aprobado más reciente con curso mapeado");
check(pickEnrollablePayment(pays.filter((p) => p.status !== "validated"), mapped), null, "sin aprobado → null");
check(pickEnrollablePayment([pays[3]!], mapped), null, "aprobado sin curso mapeado → null");

// Nota de sistema del mail corregido por el equipo.
check(
  manualEmailNote("Vane", null, "juana@gmail.com"),
  "Mail corregido por el equipo (Vane): sin mail → juana@gmail.com",
  "nota sin mail previo",
);
check(
  manualEmailNote("Vane", "juana@gmial.com", "juana@gmail.com"),
  "Mail corregido por el equipo (Vane): juana@gmial.com → juana@gmail.com",
  "nota con mail previo",
);

if (fail) {
  console.error(`${fail} fallas`);
  process.exit(1);
}
console.log("todo ok");
