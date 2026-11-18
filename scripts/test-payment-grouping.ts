// Tests deterministas del agrupado de comprobantes (BUG 4, 18/11/2026).
//   npx tsx scripts/test-payment-grouping.ts
//
// Sin red: varias imágenes pendientes del mismo pago = un solo ítem.
import {
  findGroupOf,
  groupPendingPayments,
  pickCanonical,
  type GroupablePayment,
} from "../src/lib/payments/grouping";
import {
  DISMISS_NOTE,
  canonicoDeAgrupado,
  esAgrupado,
  esDescartado,
  mergedNote,
} from "../src/lib/payments/dismiss";

let fail = 0;
function check(cond: boolean, label: string) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.error(`FAIL  ${label}`);
  }
}

let seq = 0;
function pay(p: Partial<GroupablePayment> & { id: string }): GroupablePayment {
  seq++;
  return {
    conversation_id: "c1",
    event_slug: "peelings",
    status: "pending",
    amount: null,
    operation_number: null,
    created_at: `2026-11-18T10:00:${String(seq).padStart(2, "0")}Z`,
    ...p,
  };
}

// 1. Tres imágenes del mismo pago → un grupo, canónico = la que tiene datos.
{
  seq = 0;
  const rows = [
    pay({ id: "a" }),
    pay({ id: "b", amount: 110000, operation_number: "123" }),
    pay({ id: "c", amount: 110000 }),
  ];
  const g = groupPendingPayments(rows);
  check(g.length === 1, "3 imágenes del mismo pago: un solo grupo");
  check(g[0]?.canonical.id === "b", "canónico: el que tiene monto y N° de operación");
  check(g[0]?.members.map((m) => m.id).join() === "a,b,c", "miembros en orden cronológico");
  check(g[0]?.maybeDistinct === false, "mismo monto: sin aviso de pagos distintos");
}

// 2. Sin datos leídos: el más viejo.
{
  seq = 0;
  const rows = [pay({ id: "x" }), pay({ id: "y" })];
  check(pickCanonical(rows).id === "x", "sin datos: canónico el más viejo");
  seq = 0;
  const conMonto = [pay({ id: "x" }), pay({ id: "y", amount: 110000 })];
  check(pickCanonical(conMonto).id === "y", "solo monto: gana el que tiene monto");
}

// 3. Dos N° de operación distintos leídos → dos ítems (pagos distintos).
{
  seq = 0;
  const rows = [
    pay({ id: "p1", amount: 55000, operation_number: "AAA" }),
    pay({ id: "p2", amount: 55000, operation_number: "BBB" }),
    pay({ id: "p3" }), // sin N° → va con el más viejo
  ];
  const g = groupPendingPayments(rows);
  check(g.length === 2, "N° de operación distintos: dos grupos");
  check(g[0]?.members.map((m) => m.id).join() === "p1,p3", "la imagen sin N° va con el pago más viejo");
  check(g[1]?.members.map((m) => m.id).join() === "p2", "el segundo pago queda solo");
}

// 4. Mismo N° de operación escrito distinto (espacios / minúsculas) → mismo grupo.
{
  seq = 0;
  const rows = [
    pay({ id: "o1", operation_number: "ab 12" }),
    pay({ id: "o2", operation_number: "AB12" }),
  ];
  check(groupPendingPayments(rows).length === 1, "N° de operación normalizado");
}

// 5. Montos distintos sin N° → un grupo con aviso "parecen pagos distintos".
{
  seq = 0;
  const rows = [pay({ id: "m1", amount: 110000 }), pay({ id: "m2", amount: 55000 })];
  const g = groupPendingPayments(rows);
  check(g.length === 1 && g[0]!.maybeDistinct, "montos distintos sin N°: un grupo con aviso");
}

// 6. Distinta conversación o distinto evento → no se agrupan.
{
  seq = 0;
  const rows = [
    pay({ id: "e1" }),
    pay({ id: "e2", event_slug: "congreso" }),
    pay({ id: "e3", conversation_id: "c2" }),
    pay({ id: "e4", event_slug: null }),
    pay({ id: "e5", event_slug: null }),
  ];
  const g = groupPendingPayments(rows);
  check(g.length === 4, "por conversación y evento (los null de una conversación van juntos)");
  check(
    g.find((x) => x.members.some((m) => m.id === "e4"))?.members.length === 2,
    "event_slug null: agrupa por conversación",
  );
}

// 7. Solo pendientes: un validado o rechazado no entra al grupo.
{
  seq = 0;
  const rows = [pay({ id: "v1", status: "validated" }), pay({ id: "v2" }), pay({ id: "v3", status: "rejected" })];
  const g = groupPendingPayments(rows);
  check(g.length === 1 && g[0]!.members.length === 1, "solo pendientes");
  check(findGroupOf(rows, "v1") === null, "findGroupOf de un validado: null");
  check(findGroupOf(rows, "v2")?.canonical.id === "v2", "findGroupOf de un pendiente");
}

// 8. Nota de agrupado: no es rechazo ni descarte; se recupera el canónico.
{
  const merged = { status: "rejected", validation_note: mergedNote("abc-123"), amount: null };
  check(esAgrupado(merged), "nota de agrupado reconocida");
  check(!esDescartado(merged), "agrupado sin monto no cuenta como descartado");
  check(canonicoDeAgrupado(merged) === "abc-123", "id del canónico desde la nota");
  check(!esAgrupado({ status: "validated", validation_note: mergedNote("x") }), "solo rejected");
  check(!esAgrupado({ status: "rejected", validation_note: DISMISS_NOTE }), "un descarte no es agrupado");
  check(esDescartado({ status: "rejected", validation_note: DISMISS_NOTE, amount: 1 }), "descarte sigue igual");
  check(!esDescartado({ status: "rejected", validation_note: null, amount: 110000 }), "rechazo real sigue igual");
}

console.log(fail === 0 ? "\nAGRUPADO DE COMPROBANTES OK" : `\n${fail} TEST(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
