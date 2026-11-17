// Tests deterministas de la prioridad del flag de alta automática en Tiendup
// (base > env > prendido) y del merge del jsonb auto_send.
//   npx tsx scripts/test-tiendup-auto-enroll-flag.ts
import {
  autoEnrollFromAutoSend,
  autoEnrollMetaFromAutoSend,
  mergeAutoEnroll,
  parseAutoEnrollEnv,
  resolveAutoEnroll,
} from "../src/lib/tiendup/auto-enroll-flag";

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

// Env.
check(parseAutoEnrollEnv(undefined), null, "env sin definir");
check(parseAutoEnrollEnv("  "), null, "env vacía");
for (const v of ["false", "FALSE", " 0 ", "off", "No"]) check(parseAutoEnrollEnv(v), false, `env "${v}" apaga`);
for (const v of ["true", "1", "on", "si"]) check(parseAutoEnrollEnv(v), true, `env "${v}" prende`);

// Prioridad.
check(resolveAutoEnroll({ dbValue: false, envRaw: "true" }), { enabled: false, source: "db" }, "db false gana a env true");
check(resolveAutoEnroll({ dbValue: true, envRaw: "false" }), { enabled: true, source: "db" }, "db true gana a env false");
check(resolveAutoEnroll({ dbValue: null, envRaw: "off" }), { enabled: false, source: "env" }, "sin db: env apaga");
check(resolveAutoEnroll({ dbValue: null, envRaw: "true" }), { enabled: true, source: "env" }, "sin db: env prende");
check(resolveAutoEnroll({ dbValue: null, envRaw: undefined }), { enabled: true, source: "default" }, "sin db ni env: prendido");

// Lectura del jsonb.
check(autoEnrollFromAutoSend(null), null, "auto_send null");
check(autoEnrollFromAutoSend({}), null, "auto_send sin key");
check(autoEnrollFromAutoSend({ tiendup_auto_enroll: "false" }), null, "valor no boolean se ignora");
check(autoEnrollFromAutoSend({ tiendup_auto_enroll: false }), false, "boolean false");
check(autoEnrollFromAutoSend([true]), null, "array se ignora");
check(
  autoEnrollMetaFromAutoSend({ tiendup_auto_enroll_updated_by: "p1", tiendup_auto_enroll_updated_at: "2026-11-17T10:00:00Z" }),
  { updatedBy: "p1", updatedAt: "2026-11-17T10:00:00Z" },
  "meta quién/cuándo",
);

// Merge: conserva las otras keys de la fila.
check(
  mergeAutoEnroll({ whatsapp: true, tiendup_auto_enroll: true }, false, { updatedBy: "p2", updatedAt: "t" }),
  { whatsapp: true, tiendup_auto_enroll: false, tiendup_auto_enroll_updated_by: "p2", tiendup_auto_enroll_updated_at: "t" },
  "merge no pisa otras keys",
);
check(
  mergeAutoEnroll(null, true, { updatedBy: "p", updatedAt: "t" }),
  { tiendup_auto_enroll: true, tiendup_auto_enroll_updated_by: "p", tiendup_auto_enroll_updated_at: "t" },
  "merge desde null",
);

if (fail) {
  console.error(`\n${fail} test(s) fallaron`);
  process.exit(1);
}
console.log("\nTodo ok");
