// Tests sin red de los reintentos del alta en Tiendup (fetch mockeado) y del
// texto de error legible.  npx tsx scripts/test-tiendup-enroll-retry.ts
import { postEnrollWithRetry } from "../src/lib/tiendup/enroll-request";
import { displayCourseAccessError, tidyTiendupError } from "../src/lib/tiendup/messages";

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

type Step = { status: number; body: string } | { throws: string };

/** fetch falso que responde los pasos en orden y registra las esperas. */
function mock(steps: Step[]) {
  let calls = 0;
  const waits: number[] = [];
  const fetchImpl = (async () => {
    const step = steps[Math.min(calls, steps.length - 1)]!;
    calls++;
    if ("throws" in step) throw new Error(step.throws);
    return new Response(step.body, { status: step.status });
  }) as unknown as typeof fetch;
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { fetchImpl, sleep, calls: () => calls, waits };
}

async function run(steps: Step[]) {
  const m = mock(steps);
  const res = await postEnrollWithRetry({
    url: "https://x.test/learning/courses/1/enroll",
    apiKey: "k",
    body: { customer: { email: "a@b.com" } },
    timeoutMs: 1000,
    fetchImpl: m.fetchImpl,
    sleep: m.sleep,
  });
  return { res, calls: m.calls(), waits: m.waits };
}

const SITE_NOT_FOUND = { status: 403, body: "<div>site not found</div>" };
const OK = { status: 200, body: '{"status":"OK"}' };

async function main() {
  let r = await run([OK]);
  check([r.res.ok, r.calls, r.waits], [true, 1, []], "OK de una");

  r = await run([SITE_NOT_FOUND, OK]);
  check([r.res.ok, r.calls, r.waits], [true, 2, [2000]], "403 site not found y después OK");

  r = await run([SITE_NOT_FOUND, SITE_NOT_FOUND, SITE_NOT_FOUND, SITE_NOT_FOUND]);
  check(
    [r.res.ok, r.calls, r.waits, r.res.error],
    [false, 4, [2000, 5000, 10000], "Tiendup no respondió (403 site not found)"],
    "403 site not found siempre: 3 reintentos y error sin HTML",
  );

  r = await run([{ status: 429, body: "Too Many Requests" }, { status: 502, body: "<html><body>Bad gateway</body></html>" }, OK]);
  check([r.res.ok, r.calls], [true, 3], "429 y 502 se reintentan");

  r = await run([{ throws: "fetch failed" }, OK]);
  check([r.res.ok, r.calls], [true, 2], "error de red se reintenta");

  r = await run([{ throws: "The operation was aborted due to timeout" }, { throws: "timeout" }, { throws: "timeout" }]);
  check([r.res.ok, r.calls, r.res.error], [false, 4, "Tiendup sin respuesta: timeout"], "timeout siempre: 4 intentos");

  r = await run([{ status: 422, body: '{"message":"invalid email"}' }, OK]);
  check(
    [r.res.ok, r.calls, r.res.error],
    [false, 1, 'Tiendup 422: {"message":"invalid email"}'],
    "422 de validación no se reintenta",
  );

  r = await run([{ status: 403, body: '{"message":"forbidden"}' }, OK]);
  check([r.res.ok, r.calls], [false, 1], "403 sin site not found (key) no se reintenta");

  r = await run([{ status: 200, body: '{"status":"ERROR"}' }]);
  check([r.res.ok, r.calls], [false, 1], "2xx con status distinto de OK no se reintenta");

  // Texto de error legible (también para errores viejos guardados con HTML).
  check(tidyTiendupError("Tiendup 403: <div>site not found</div>"), "Tiendup no respondió (403 site not found)", "403 HTML");
  check(tidyTiendupError("Tiendup 500: "), "Tiendup no respondió (500)", "500 sin cuerpo");
  check(tidyTiendupError("Tiendup no respondió (403 site not found)"), "Tiendup no respondió (403 site not found)", "idempotente");
  check(
    displayCourseAccessError("Tiendup 403: <div>site not found</div>"),
    "Tiendup no respondió (403 site not found)",
    "displayCourseAccessError limpia errores viejos",
  );
  check(displayCourseAccessError("NOT_IN_TIENDUP: El mail no figura en Tiendup"), "El mail no figura en Tiendup", "marcador NOT_IN_TIENDUP");

  console.log(fail === 0 ? "\nTIENDUP ENROLL RETRY OK" : `\n${fail} TEST(S) FALLARON`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
