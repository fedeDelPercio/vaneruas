// Tests sin red de la lógica pura de /metrics (ventanas, tasa por día, delta,
// exclusión del cierre masivo).  npx tsx scripts/test-metrics-series.ts
import {
  automationRate,
  avgByDay,
  buildApprovalsDaily,
  buildKpi,
  comprobantesRecibidos,
  countByDay,
  metricWindow,
  rateByDay,
  relativeDelta,
  sparklineValues,
  type MetricsPaymentRow,
} from "../src/lib/metrics/series";
import { CIERRE_MASIVO_NOTE, DISMISS_NOTE, esCierreMasivo, esDescartado, mergedNote } from "../src/lib/payments/dismiss";

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

// --- Ventana: 19/11 02:00 UTC todavía es 18/11 en Argentina.
const now = new Date("2026-11-19T02:00:00.000Z");
const w = metricWindow(7, now);
check(w.keys, ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"], "7 días terminan hoy en hora AR");
check(w.since, "2026-11-12T03:00:00.000Z", "arranque del período a las 00 AR");
check(w.prevSince, "2026-11-05T03:00:00.000Z", "período anterior de igual largo");

// --- Conteo por día en hora AR.
check(
  countByDay(["2026-11-13T02:59:00.000Z", "2026-11-13T03:00:00.000Z", "2026-11-01T12:00:00.000Z"], ["2026-11-12", "2026-11-13"]),
  [1, 1],
  "02:59 UTC cuenta al día anterior; fuera de rango se ignora",
);

// --- Tasa de automatización.
check(automationRate(3, 1), 75, "3 IA / 1 equipo = 75%");
check(automationRate(2, 1), 66.7, "un decimal");
check(automationRate(0, 0), null, "sin salientes: sin dato");
const keys = ["2026-11-12", "2026-11-13", "2026-11-14"];
check(
  rateByDay(
    ["2026-11-12T15:00:00Z", "2026-11-13T15:00:00Z", "2026-11-13T16:00:00Z"],
    ["2026-11-13T17:00:00Z"],
    keys,
    new Date("2026-11-13T03:00:00Z").getTime(),
  ),
  [null, 66.7, null],
  "día sin cobertura del equipo = null; día sin salientes = null",
);

// --- Delta (regla de Hábitat).
check(relativeDelta(110, 100), 10, "sube 10%");
check(relativeDelta(50, 100), -50, "baja 50%");
check(relativeDelta(5, 0), null, "base 0 con actual > 0: sin dato");
check(relativeDelta(0, 0), 0, "0 vs 0: sin cambio");
check(relativeDelta(5, null), null, "sin anterior");
const k = buildKpi(12, 10, keys, [1, null, 3]);
check([k.delta, k.series.map((p) => p.value)], [20, [1, null, 3]], "buildKpi arma delta y serie");
check(sparklineValues(buildKpi(1, null, keys, [1, null, null])), null, "sparkline con un solo punto: no se dibuja");

// --- Promedio por día.
check(
  avgByDay([{ at: "2026-11-12T15:00:00Z", ms: 100 }, { at: "2026-11-12T16:00:00Z", ms: 300 }], keys),
  [200, null, null],
  "promedio por día de validación",
);

// --- Cierre masivo.
check(esCierreMasivo({ validation_note: CIERRE_MASIVO_NOTE }), true, "nota exacta");
check(esCierreMasivo({ validation_note: `${CIERRE_MASIVO_NOTE} · extra` }), true, "títulos: empieza con la nota");
check(esCierreMasivo({ validation_note: "Resuelto por WhatsApp" }), false, "otra nota no es cierre masivo");
check(esCierreMasivo({ validation_note: null }), false, "sin nota");
// esDescartado no cambia por el helper nuevo.
check(esDescartado({ status: "rejected", validation_note: CIERRE_MASIVO_NOTE, amount: null }), true, "esDescartado sigue igual (sin monto)");

// --- Comprobantes recibidos: sin agrupados, descartados ni cierre masivo;
//     pendientes por grupo.
const base = { conversation_id: "c1", event_slug: "ev", operation_number: null } as const;
const pay = (id: string, status: string, note: string | null, amount: number | null, created_at = "2026-11-12T15:00:00Z"): MetricsPaymentRow => ({
  ...base,
  id,
  status,
  validation_note: note,
  amount,
  created_at,
});
const rows: MetricsPaymentRow[] = [
  pay("a", "validated", null, 1000),
  pay("b", "rejected", mergedNote("a"), 1000),
  pay("c", "rejected", DISMISS_NOTE, 1000),
  pay("d", "rejected", "monto incorrecto", 500),
  pay("e", "rejected", CIERRE_MASIVO_NOTE, 800),
  pay("f", "validated", CIERRE_MASIVO_NOTE, 800),
  pay("g", "pending", null, 700, "2026-11-13T15:00:00Z"),
  pay("h", "pending", null, 700, "2026-11-13T15:05:00Z"),
];
check(comprobantesRecibidos(rows).length, 3, "validado + rechazado real + 1 grupo pendiente");

// --- Aprobaciones del equipo.
const approvals = buildApprovalsDaily(
  [
    { status: "validated", validated_at: "2026-11-12T15:00:00Z", validation_note: null },
    { status: "rejected", validated_at: "2026-11-12T16:00:00Z", validation_note: DISMISS_NOTE },
    { status: "rejected", validated_at: "2026-11-12T16:00:00Z", validation_note: "no sirve" },
    { status: "rejected", validated_at: "2026-11-12T16:00:00Z", validation_note: mergedNote("x") },
    { status: "rejected", validated_at: "2026-11-12T16:00:00Z", validation_note: CIERRE_MASIVO_NOTE },
    { status: "validated", validated_at: "2026-11-13T16:00:00Z", validation_note: CIERRE_MASIVO_NOTE },
    { status: "validated", validated_at: null, validation_note: null },
    { status: "pending", validated_at: "2026-11-13T16:00:00Z", validation_note: null },
  ],
  [
    { reviewed_at: "2026-11-14T12:00:00Z", validation_note: null },
    { reviewed_at: "2026-11-14T12:00:00Z", validation_note: `${CIERRE_MASIVO_NOTE}` },
    { reviewed_at: null, validation_note: null },
  ],
  keys,
);
check(
  approvals,
  [
    { date: "2026-11-12", comprobantesValidados: 1, comprobantesRechazados: 2, titulos: 0 },
    { date: "2026-11-13", comprobantesValidados: 0, comprobantesRechazados: 0, titulos: 0 },
    { date: "2026-11-14", comprobantesValidados: 0, comprobantesRechazados: 0, titulos: 1 },
  ],
  "aprobaciones: sin agrupados ni cierre masivo; descartados cuentan como rechazados",
);

if (fail) {
  console.error(`\n${fail} fallaron`);
  process.exit(1);
}
console.log("\ntodo ok");
