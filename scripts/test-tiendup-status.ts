// Tests sin red del estado en vivo de Tiendup (bloque de la ficha).
//   npx tsx scripts/test-tiendup-status.ts
import { decideTiendupStatus, maskEmail, paymentsWithEnrollAttempt, tiendupEditorMode } from "../src/lib/tiendup/status";
import { notInTiendupError } from "../src/lib/tiendup/messages";

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

const enrolled = [
  { name: "Maria", lastName: "Perez Gomez", email: "maria.perez@gmail.com" },
  { name: "Lucia", lastName: "Fernandez", email: "lucifer@hotmail.com.ar" },
];
const full = { enrolled, complete: true };
const cut = { enrolled, complete: false };
// Clientes de la tienda (GET /customers).
const shopCustomers = [
  { id: "1", name: "Maria", lastName: "Perez Gomez", email: "maria.perez@gmail.com" },
  { id: "2", name: "Ana", lastName: "Ruiz", email: "Ana.Ruiz@Gmail.com " },
];
const custFull = { customers: shopCustomers, complete: true };
const custCut = { customers: shopCustomers, complete: false };
const custCutEmpty = { customers: [], complete: false };

// Estado.
check(
  decideTiendupStatus({ listing: full, email: "maria.perez@gmail.com", fullName: null, lastError: null }),
  { state: "enrolled" },
  "figura con el mismo correo",
);
check(
  decideTiendupStatus({ listing: full, email: "_mariaperez@gmail.com", fullName: null, lastError: null }),
  { state: "enrolled" },
  "correo con basura al principio igual matchea",
);
check(
  decideTiendupStatus({ listing: full, email: "lu.fer@yahoo.com", fullName: "Lucía Fernández", lastError: null }),
  { state: "other_email", otherEmailMasked: "lu***@ho***.com.ar" },
  "misma persona con otro correo",
);
check(
  decideTiendupStatus({ listing: full, customers: custFull, email: "otra@gmail.com", fullName: "Ana Ruiz", lastError: null }),
  { state: "not_found" },
  "no inscripta y no es cliente (ambos listados completos)",
);
check(
  decideTiendupStatus({ listing: full, email: "otra@gmail.com", fullName: "Ana Ruiz", lastError: null }),
  { state: "unavailable" },
  "no inscripta y sin datos de clientes: no afirma not_found",
);
check(
  decideTiendupStatus({ listing: full, customers: custFull, email: "ana.ruiz@gmail.com", fullName: "Ana Ruiz", lastError: null }),
  { state: "customer_not_enrolled" },
  "es cliente de la tienda pero no está en el curso",
);
check(
  decideTiendupStatus({ listing: full, customers: custCut, email: "ana.ruiz@gmail.com", fullName: null, lastError: null }),
  { state: "customer_not_enrolled" },
  "cliente visto en listado parcial = prueba positiva",
);
check(
  decideTiendupStatus({ listing: full, customers: custCutEmpty, email: "otra@gmail.com", fullName: null, lastError: null }),
  { state: "unavailable" },
  "clientes cortados y no aparece: unavailable",
);
// Marcador NOT_IN_TIENDUP del alta automática.
check(
  decideTiendupStatus({ listing: null, email: "otra@gmail.com", fullName: null, lastError: notInTiendupError() }),
  { state: "not_found" },
  "marcador NOT_IN_TIENDUP con Tiendup caído → not_found",
);
check(
  decideTiendupStatus({ listing: cut, customers: custCutEmpty, email: "otra@gmail.com", fullName: null, lastError: notInTiendupError() }),
  { state: "not_found" },
  "marcador NOT_IN_TIENDUP con listados cortados → not_found",
);
check(
  decideTiendupStatus({ listing: full, customers: custFull, email: "ana.ruiz@gmail.com", fullName: null, lastError: notInTiendupError() }),
  { state: "customer_not_enrolled" },
  "marcador viejo pero ahora es cliente: manda Tiendup en vivo",
);
check(
  decideTiendupStatus({ listing: full, email: "maria.perez@gmail.com", fullName: null, lastError: notInTiendupError() }),
  { state: "enrolled" },
  "marcador viejo pero ya está inscripta",
);
check(
  decideTiendupStatus({ listing: full, email: "x@gmail.com", fullName: null, lastError: notInTiendupError() }),
  { state: "not_found" },
  "no inscripta, clientes sin consultar, con marcador → not_found",
);
check(
  decideTiendupStatus({ listing: full, email: "otra@gmail.com", fullName: "Ana Ruiz", lastError: "Tiendup 500: boom" }),
  { state: "error", error: "Tiendup no respondió (500 boom)" },
  "no figura y el último intento falló",
);
check(
  decideTiendupStatus({ listing: full, email: "maria.perez@gmail.com", fullName: null, lastError: "viejo" }),
  { state: "enrolled" },
  "figura aunque haya error guardado: manda Tiendup",
);
check(
  decideTiendupStatus({ listing: cut, email: "maria.perez@gmail.com", fullName: null, lastError: null }),
  { state: "unavailable" },
  "listado cortado no afirma nada",
);
check(
  decideTiendupStatus({ listing: cut, email: "x@gmail.com", fullName: null, lastError: "timeout" }),
  { state: "error", error: "timeout" },
  "listado cortado con error guardado",
);
check(
  decideTiendupStatus({ listing: null, email: "x@gmail.com", fullName: null, lastError: "   " }),
  { state: "unavailable" },
  "sin key (listing null) y error vacío",
);
check(
  decideTiendupStatus({ listing: { enrolled: [], complete: true }, customers: { customers: [], complete: true }, email: "x@gmail.com", fullName: "Ana", lastError: null }),
  { state: "not_found" },
  "curso vacío",
);

// Máscara.
check(maskEmail("maria.perez@gmail.com"), "ma***@gm***.com", "máscara gmail");
check(maskEmail("a@b.co"), "a***@b***.co", "máscara corta");
check(maskEmail("sin-arroba"), "si***", "máscara sin arroba");
check(maskEmail(null), null, "máscara null");
check(maskEmail("x@localhost"), "x***@lo***", "máscara sin punto en dominio");

// Intentos de alta.
check(
  [...paymentsWithEnrollAttempt({
    payments: [{ id: "p9", course_access_granted_at: null, course_access_error: notInTiendupError() }],
    notificationReasons: [],
  })],
  ["p9"],
  "el marcador NOT_IN_TIENDUP cuenta como intento",
);
const pays = [
  { id: "p1", course_access_granted_at: null, course_access_error: null },
  { id: "p2", course_access_granted_at: "2026-11-17T10:00:00Z", course_access_error: null },
  { id: "p3", course_access_granted_at: null, course_access_error: "Tiendup 500" },
  { id: "p4", course_access_granted_at: null, course_access_error: "  " },
];
check(
  [...paymentsWithEnrollAttempt({ payments: pays, notificationReasons: [] })].sort(),
  ["p2", "p3"],
  "acceso marcado o error guardado",
);
check(
  [
    ...paymentsWithEnrollAttempt({
      payments: pays,
      notificationReasons: ["tiendup_alta_pendiente_p1", "tiendup_aviso_sin_enviar_p4", "tiendup_alta_pendiente_otro", null, "humano_sin_respuesta"],
    }),
  ].sort(),
  ["p1", "p2", "p3", "p4"],
  "notificaciones tiendup_* de sus comprobantes",
);
check(
  paymentsWithEnrollAttempt({ payments: [pays[0]!], notificationReasons: ["tiendup_alta_pendiente_ajeno"] }).size,
  0,
  "sin intentos",
);

// Campo de mail del bloque: destacado / colapsado / normal.
{
  const m = (accessState: Parameters<typeof tiendupEditorMode>[0]["accessState"], savedEmail: string | null = "a@gmail.com", mailState: Parameters<typeof tiendupEditorMode>[0]["mailState"] = "has_courses") =>
    tiendupEditorMode({ accessState, savedEmail, mailState });
  for (const st of ["error", "not_found", "pending", "granted_missing", "other_email", "unavailable"] as const) {
    check(m(st), "highlight", `editor destacado con ${st}`);
  }
  check(m("enrolled"), "collapsed", "acceso enviado (enrolled) → colapsado");
  check(m("granted"), "collapsed", "acceso enviado (granted) → colapsado");
  check(m("enrolled", null, "no_email"), "collapsed", "enviado gana aunque no haya mail guardado");
  check(m("awaiting_approval"), "normal", "falta aprobar → normal");
  check(m("no_mapping"), "normal", "sin curso → normal");
  check(m(null), "normal", "sin inscripción actual → normal");
  check(m("awaiting_approval", null, "no_email"), "highlight", "sin mail guardado → destacado");
  check(m(null, "  "), "highlight", "mail vacío → destacado");
}

if (fail) {
  console.error(`\n${fail} fallaron`);
  process.exit(1);
}
console.log("\nTodo ok");
