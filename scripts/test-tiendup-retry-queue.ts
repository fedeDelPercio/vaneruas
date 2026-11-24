// Tests sin red ni base de la cola de reintentos de Tiendup: clasificador,
// reintento por página, deadline del alta, marcadores y decisiones de la cola.
//   npx tsx scripts/test-tiendup-retry-queue.ts
import { fetchAllCustomers } from "../src/lib/tiendup/customers";
import { fetchAllEnrolled } from "../src/lib/tiendup/enrolled-list";
import { ENROLL_RETRY_DELAYS_MS, postEnrollWithRetry } from "../src/lib/tiendup/enroll-request";
import {
  TIENDUP_QUEUED_MESSAGE,
  TIENDUP_QUEUED_SILENT_MESSAGE,
  displayCourseAccessError,
  errorAfterEmailChange,
  gaveUpError,
  isGaveUpError,
  isNotInTiendupError,
  isSilentAccessError,
  nameConflictError,
  nextRetryError,
  notInTiendupError,
  parseRetryError,
  retryError,
} from "../src/lib/tiendup/messages";
import {
  RETRY_GIVE_UP_MS,
  RETRY_MIN_INTERVAL_MS,
  RETRY_LOOKBACK_MS,
  decideRetry,
  planRetries,
  retryResultOf,
  runRetryPlan,
  type RetryAttemptResult,
  type RetryRow,
} from "../src/lib/tiendup/retry-policy";
import { isTransientStoredError, isTransientTiendupResponse } from "../src/lib/tiendup/transient";
import { decideCurrentAccess, decideTiendupStatus, tiendupEditorMode } from "../src/lib/tiendup/status";

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

const SNF = "<div>site not found</div> <p style=\"font-size: 8px; color: #d3d3d3\">cuatrocientos tres</p>";
const NOW = Date.parse("2026-11-22T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

function row(over: Partial<RetryRow> = {}): RetryRow {
  return {
    id: "p1",
    conversation_id: "c1",
    event_slug: "masterclass-peelings-verano",
    status: "validated",
    awaiting_title: false,
    course_access_granted_at: null,
    course_access_error: null,
    updated_at: ago(10 * MIN),
    created_at: ago(60 * MIN),
    ...over,
  };
}
const decide = (r: RetryRow, waits = true, mail = true) =>
  decideRetry({ row: r, now: NOW, waitsForAccess: waits, hasValidEmail: mail });

/** fetch falso por secuencia de respuestas. */
function seq(steps: (Response | Error)[]) {
  const urls: string[] = [];
  let i = 0;
  const impl = async (url: string) => {
    urls.push(url);
    const s = steps[Math.min(i++, steps.length - 1)]!;
    if (s instanceof Error) throw s;
    return s.clone();
  };
  return { impl, urls };
}
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const forbidden = () => new Response(SNF, { status: 403 });

async function main() {
  // --- Clasificador ---
  check(isTransientTiendupResponse(403, SNF), true, "403 site not found es transitorio");
  check(isTransientTiendupResponse(403, '{"message":"forbidden"}'), false, "403 de key no");
  check([429, 500, 502, 503].map((s) => isTransientTiendupResponse(s, "")), [true, true, true, true], "429 y 5xx sí");
  check([400, 401, 404, 422].map((s) => isTransientTiendupResponse(s, "")), [false, false, false, false], "otros 4xx no");
  check(isTransientStoredError("Tiendup no respondió (403 site not found)"), true, "error viejo prolijo");
  check(isTransientStoredError(`Tiendup 403: ${SNF}`), true, "error viejo crudo");
  check(isTransientStoredError("Tiendup sin respuesta: fetch failed"), true, "error viejo de red");
  check(isTransientStoredError("Tiendup no respondió (404 Not Found)"), false, "404 con HTML no");
  check(isTransientStoredError('Tiendup 422: {"message":"invalid"}'), false, "422 guardado no");

  // --- Reintento por página ---
  {
    const waits: number[] = [];
    const { impl, urls } = seq([
      json({ data: [{ id: 1, email: "a@x.com" }], count: 2, pages: 2, current: 1 }),
      forbidden(),
      forbidden(),
      json({ data: [{ id: 2, email: "b@x.com" }], count: 2, pages: 2, current: 2 }),
    ]);
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: "https://x.test", fetchImpl: impl, sleep: async (ms) => void waits.push(ms) });
    check([r.ok, r.complete, r.customers.length, urls.length, waits], [true, true, 2, 4, [1000, 3000]], "clientes: reintenta la página 2 y completa");
  }
  {
    const { impl, urls } = seq([json({ data: [{ id: 1, email: "a@x.com" }], count: 2, pages: 2 }), forbidden()]);
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: "https://x.test", fetchImpl: impl, sleep: async () => {} });
    check([r.ok, r.complete, urls.length], [false, false, 4], "clientes: si sigue caído, nunca dice completo");
  }
  {
    const { impl, urls } = seq([new Response("no", { status: 401 })]);
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: "https://x.test", fetchImpl: impl, sleep: async () => {} });
    check([r.complete, urls.length], [false, 1], "clientes: 401 no se reintenta");
  }
  {
    const { impl, urls } = seq([forbidden(), json({ data: [{ name: "A", email: "a@x.com" }], pages: 1 })]);
    const r = await fetchAllEnrolled({ apiKey: "k", baseUrl: "https://x.test", courseId: 1, timeoutMs: 1000, fetchImpl: impl, sleep: async () => {} });
    check([r.complete, r.enrolled.length, urls.length], [true, 1, 2], "inscriptos: reintenta la página");
  }
  {
    const { impl } = seq([json({ data: [{ email: "a@x.com" }], pages: 2 }), new Error("red")]);
    const r = await fetchAllEnrolled({ apiKey: "k", baseUrl: "https://x.test", courseId: 1, timeoutMs: 1000, fetchImpl: impl, sleep: async () => {} });
    check([r.complete, r.enrolled.length], [false, 1], "inscriptos: caído a mitad, incompleto");
  }

  // --- Alta: esperas y deadline ---
  check([...ENROLL_RETRY_DELAYS_MS], [2000, 5000, 10000], "esperas del alta");
  {
    let clock = 0;
    const waits: number[] = [];
    let calls = 0;
    const res = await postEnrollWithRetry({
      url: "https://x.test/e",
      apiKey: "k",
      body: {},
      timeoutMs: 20_000,
      now: () => clock,
      deadlineAt: 35_000,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      fetchImpl: (async () => {
        calls++;
        clock += 15_000; // cada intento tarda 15 s
        return new Response(SNF, { status: 403 });
      }) as unknown as typeof fetch,
    });
    check([res.ok, res.transient, calls, waits], [false, true, 2, [2000]], "deadline: no arranca un reintento que no entra");
    check(clock <= 35_000, true, "deadline: termina dentro del tope");
  }
  {
    let signalMs = 0;
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = ((ms: number) => {
      signalMs = ms;
      return realTimeout.call(AbortSignal, ms);
    }) as typeof AbortSignal.timeout;
    await postEnrollWithRetry({
      url: "https://x.test/e",
      apiKey: "k",
      body: {},
      timeoutMs: 20_000,
      now: () => 30_000,
      deadlineAt: 35_000,
      delaysMs: [],
      fetchImpl: (async () => new Response('{"status":"OK"}')) as unknown as typeof fetch,
    });
    AbortSignal.timeout = realTimeout;
    check(signalMs, 5000, "deadline: el timeout del request se recorta");
  }
  {
    let calls = 0;
    const res = await postEnrollWithRetry({
      url: "https://x.test/e",
      apiKey: "k",
      body: {},
      timeoutMs: 20_000,
      now: () => 40_000,
      deadlineAt: 35_000,
      fetchImpl: (async () => {
        calls++;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    check([res.ok, res.transient, calls], [false, true, 0], "deadline vencido: no llama y queda transitorio");
  }

  // --- Marcadores ---
  const at = ago(5 * MIN);
  const manual = retryError("manual", `Tiendup 403: ${SNF}`, at);
  check(manual.startsWith("RETRY_MANUAL: "), true, "prefijo manual estable");
  check(parseRetryError(manual)?.kind, "manual", "parsea el modo");
  check(parseRetryError(manual)?.firstFailedAt, at, "parsea el primer fallo");
  check(displayCourseAccessError(manual), "Tiendup no respondió (403 site not found cuatrocientos tres)", "display saca el prefijo y el HTML");
  check(displayCourseAccessError(retryError("auto", "No se pudo verificar el correo", at)), "No se pudo verificar el correo", "display saca RETRY_AUTO");
  check(displayCourseAccessError(gaveUpError("Tiendup no respondió (500)")), "Tiendup no respondió (500)", "display saca RETRY_GAVE_UP");
  check(displayCourseAccessError(nameConflictError()), "Figura inscripta en Tiendup con otro correo", "display saca NAME_CONFLICT");
  check(isNotInTiendupError(manual), false, "un RETRY no es NOT_IN_TIENDUP");
  check(isNotInTiendupError(notInTiendupError()), true, "NOT_IN_TIENDUP sigue igual");
  check(parseRetryError(notInTiendupError()), null, "NOT_IN_TIENDUP no es RETRY");
  check(retryError("auto", manual, at).includes("RETRY_MANUAL"), false, "no anida marcadores");

  // --- Selección ---
  check(decide(row()), { action: "retry", mode: "auto" }, "sin error (mail cargado después): entra en auto");
  check(decide(row({ course_access_error: "Tiendup no respondió (403 site not found)" })), { action: "retry", mode: "auto" }, "error viejo transitorio: entra en auto");
  check(decide(row({ course_access_error: retryError("auto", "x", ago(10 * MIN)) })), { action: "retry", mode: "auto" }, "RETRY_AUTO: auto");
  check(decide(row({ course_access_error: retryError("manual", "x", ago(10 * MIN)) })), { action: "retry", mode: "manual" }, "RETRY_MANUAL: manual");
  check(decide(row({ course_access_error: notInTiendupError() })).action, "skip", "NOT_IN_TIENDUP necesita a una persona");
  check(decide(row({ course_access_error: nameConflictError() })).action, "skip", "conflicto de nombre necesita a una persona");
  check(decide(row({ course_access_error: 'Tiendup 422: {"m":"x"}' })).action, "skip", "error no transitorio no entra");
  check(decide(row({ course_access_error: gaveUpError("x") })).action, "skip", "agotado no vuelve a entrar");
  check(decide(row({ course_access_granted_at: ago(0), course_access_error: manual })).action, "skip", "alta registrada: ignora una marca de reintento vieja");
  check(decide(row(), false).action, "skip", "no espera acceso");
  check(decide(row(), true, false).action, "skip", "sin correo válido");

  // --- Backoff y 24 h ---
  check(decide(row({ updated_at: ago(RETRY_MIN_INTERVAL_MS - 1000) })).action, "wait", "menos de 2 min: espera");
  check(decide(row({ updated_at: ago(RETRY_MIN_INTERVAL_MS) })).action, "retry", "a los 2 min: reintenta");
  check(decide(row({ created_at: ago(RETRY_LOOKBACK_MS + MIN) })).action, "skip", "backlog viejo sin marcador: no entra");
  check(decide(row({ created_at: ago(RETRY_LOOKBACK_MS - MIN) })).action, "retry", "sin marcador dentro de 72 h: entra");
  check(
    decide(row({ created_at: ago(30 * 24 * 60 * MIN), course_access_error: retryError("auto", "caído", ago(60 * MIN)) })).action,
    "retry",
    "viejo pero con marcador RETRY_: sigue en cola",
  );
  check(
    decide(row({ course_access_error: retryError("auto", "caído", ago(RETRY_GIVE_UP_MS)), updated_at: ago(MIN) })),
    { action: "give_up", text: "caído" },
    "a las 24 h del primer fallo: abandona aunque el último intento sea reciente",
  );
  check(decide(row({ course_access_error: retryError("auto", "x", ago(RETRY_GIVE_UP_MS - MIN)) })).action, "retry", "antes de las 24 h sigue");
  check(
    decide(row({ course_access_error: "Tiendup no respondió (403 site not found)", updated_at: ago(2 * RETRY_GIVE_UP_MS) })).action,
    "retry",
    "los trabados del 20/11 sin marcador se rescatan",
  );

  // --- Plan ---
  {
    const plan = planRetries(
      [
        row({ id: "viejo", updated_at: ago(60 * MIN) }),
        row({ id: "nuevo", updated_at: ago(5 * MIN) }),
        row({ id: "man", updated_at: ago(3 * MIN), course_access_error: retryError("manual", "x", ago(3 * MIN)) }),
        row({ id: "espera", updated_at: ago(MIN) }),
        row({ id: "vence", course_access_error: retryError("auto", "x", ago(RETRY_GIVE_UP_MS + MIN)) }),
        row({ id: "humano", course_access_error: notInTiendupError() }),
      ],
      { now: NOW, waitsForAccess: () => true, hasValidEmail: () => true },
    );
    check(plan.retry.map((r) => r.row.id), ["man", "viejo", "nuevo"], "manual primero, después el más viejo");
    check([plan.giveUp.map((g) => g.row.id), plan.waiting], [["vence"], 1], "separa vencidos y en espera");
  }

  // --- Enviar a Tiendup: la cola nunca le escribe a la persona ---
  {
    const nowIso = new Date(NOW).toISOString();
    const silent = retryError("manual", "caído", at, true);
    check(silent, `RETRY_MANUAL_SILENT: [${at}] caído`, "formato del marcador silencioso");
    check(parseRetryError(silent), { kind: "manual", silent: true, firstFailedAt: at, text: "caído" }, "parsea el silencioso");
    check(displayCourseAccessError(silent), "caído", "display saca el prefijo silencioso");
    check(parseRetryError(`RETRY_MANUAL: [${at}] caído`)?.silent, false, "marcador viejo manual sigue avisando");
    check(parseRetryError(`RETRY_AUTO: [${at}] caído`)?.silent, false, "marcador viejo auto sigue avisando");
    check(parseRetryError("RETRY_MANUAL: sin fecha")?.firstFailedAt, null, "marcador viejo sin fecha");
    check(retryError("manual", "x", at), `RETRY_MANUAL: [${at}] x`, "sin silencio el formato no cambia");

    check(decide(row({ course_access_error: silent })), { action: "retry", mode: "manual", notify: false }, "cola: silencioso reintenta sin aviso");
    check(decide(row({ course_access_error: retryError("auto", "x", at, true) })), { action: "retry", mode: "auto", notify: false }, "cola: auto silencioso sin aviso");
    check(decide(row({ course_access_error: retryError("manual", "x", at) })).action === "retry" && !("notify" in decide(row({ course_access_error: retryError("manual", "x", at) }))), true, "cola: Dar acceso sigue avisando");
    const plan = planRetries(
      [row({ id: "mudo", course_access_error: silent }), row({ id: "avisa", course_access_error: retryError("manual", "x", at) })],
      { now: NOW, waitsForAccess: () => true, hasValidEmail: () => true },
    );
    check(Object.fromEntries(plan.retry.map((r) => [r.row.id, r.notify ?? true])), { mudo: false, avisa: true }, "plan: lleva la intención de aviso");

    const write = (stored: string | null, mode: "manual" | "auto", notify: boolean, queueOff = false) =>
      nextRetryError({ stored, mode, notify, text: "caído", nowIso, queueOff });
    check(write(null, "manual", false), `RETRY_MANUAL_SILENT: [${nowIso}] caído`, "Enviar a Tiendup escribe silencioso");
    check(write(null, "manual", true), `RETRY_MANUAL: [${nowIso}] caído`, "Dar acceso escribe con aviso");
    check(write(null, "auto", true), `RETRY_AUTO: [${nowIso}] caído`, "automático escribe con aviso");
    check(write(silent, "manual", false), `RETRY_MANUAL_SILENT: [${at}] caído`, "reintento silencioso conserva marca y plazo");
    check(write(silent, "auto", true), `RETRY_MANUAL_SILENT: [${at}] caído`, "un intento automático no le saca el silencio");
    check(write(silent, "manual", true), `RETRY_MANUAL: [${nowIso}] caído`, "Dar acceso explícito vuelve a avisar, plazo nuevo");
    check(write(retryError("manual", "x", at), "manual", false), `RETRY_MANUAL_SILENT: [${nowIso}] caído`, "Enviar a Tiendup sobre un pedido con aviso lo silencia");
    check(write(null, "manual", false, true), `RETRY_AUTO_SILENT: [${nowIso}] caído`, "cola apagada: queda automático y silencioso");

    const gave = gaveUpError("caído", true);
    check([gave, isGaveUpError(gave), isSilentAccessError(gave), displayCourseAccessError(gave)], ["RETRY_GAVE_UP_SILENT: caído", true, true, "caído"], "agotado conserva el silencio");
    check(decide(row({ course_access_error: gave })).action, "skip", "agotado silencioso no vuelve a la cola");
    check(gaveUpError("caído"), "RETRY_GAVE_UP: caído", "agotado sin silencio no cambia");
    check(isSilentAccessError(retryError("manual", "x", at)), false, "con aviso no es silencioso");
    check(isSilentAccessError(notInTiendupError()), false, "NOT_IN_TIENDUP no es silencioso");

    check(errorAfterEmailChange(retryError("manual", "x", at), nowIso), null, "cambio de mail limpia el error común");
    check(errorAfterEmailChange(silent, nowIso), `RETRY_AUTO_SILENT: [${nowIso}] caído`, "cambio de mail no habilita el aviso");
    check(TIENDUP_QUEUED_SILENT_MESSAGE, "Tiendup no responde ahora. Quedó en cola: se reintenta solo cada minuto.", "mensaje en cola de la ficha");
    check(/aviso/i.test(TIENDUP_QUEUED_SILENT_MESSAGE), false, "la ficha no promete aviso");
    check(/aviso/i.test(TIENDUP_QUEUED_MESSAGE), true, "Dar acceso sigue prometiendo aviso");
  }

  // --- Resultado del alta ---
  check(retryResultOf({ kind: "enrolled" }), "ok", "enrolled = ok");
  check(retryResultOf({ kind: "already_enrolled" }), "ok", "already_enrolled = ok");
  check(retryResultOf({ kind: "listing_failed" }), "transient", "listado caído = transitorio");
  check(retryResultOf({ kind: "customer_check_failed" }), "transient", "clientes caído = transitorio");
  check(retryResultOf({ kind: "enroll_failed", transient: true }), "transient", "POST transitorio");
  check(retryResultOf({ kind: "enroll_failed", transient: false }), "failed", "POST no transitorio");
  check(retryResultOf({ kind: "not_in_tiendup" }), "failed", "no figura = lo ve el equipo");

  // --- Circuit breaker y tope ---
  const runWith = async (results: RetryAttemptResult[], max = 8, waiting = 0) => {
    const seen: number[] = [];
    const summary = await runRetryPlan({
      items: results.map((_, i) => i),
      max,
      waiting,
      attempt: async (i) => {
        seen.push(i);
        return results[i]!;
      },
    });
    return { seen, summary };
  };
  {
    const { seen, summary } = await runWith(["ok", "transient", "ok", "ok"]);
    check(seen, [0, 1], "corta al primer transitorio");
    check(summary, { attempted: 2, ok: 1, pending: 3, tripped: true }, "resumen del corte");
  }
  {
    const { seen, summary } = await runWith(Array<RetryAttemptResult>(12).fill("ok"));
    check([seen.length, summary.ok, summary.pending, summary.tripped], [8, 8, 4, false], "máximo 8 por corrida");
  }
  {
    const { seen, summary } = await runWith(["failed", "ok"]);
    check([seen, summary.pending, summary.tripped], [[0, 1], 0, false], "un fallo propio no corta la corrida");
  }
  {
    const { seen, summary } = await runWith(["skipped", "ok", "ok"], 2);
    check([seen, summary.attempted], [[0, 1, 2], 2], "tomado por otro proceso no consume el tope");
  }
  {
    let n = 0;
    const s = await runRetryPlan({ items: [1, 2, 3], max: 8, shouldStop: () => n >= 1, attempt: async () => (n++, "ok") });
    check([n, s.pending], [1, 2], "respeta el presupuesto de tiempo");
  }

  // --- Ficha ---
  const queued = decideTiendupStatus({
    listing: { enrolled: [], complete: true },
    email: "a@x.com",
    fullName: "Ana",
    lastError: retryError("auto", "Tiendup no respondió (403 site not found)", at),
  });
  check(queued, { state: "queued", error: "Tiendup no respondió (403 site not found)" }, "ficha: estado en cola");
  check(
    decideTiendupStatus({
      listing: { enrolled: [{ name: "Ana", lastName: null, email: "a@x.com" }], complete: true },
      email: "a@x.com",
      fullName: "Ana",
      lastError: retryError("auto", "x", at),
    }).state,
    "enrolled",
    "ficha: si ya figura, manda Tiendup",
  );
  check(
    decideCurrentAccess({ paymentStatus: "validated", granted: false, courseId: 1, courseState: queued, listingComplete: true }).state,
    "queued",
    "ficha: línea de acceso en cola",
  );
  check(tiendupEditorMode({ mailState: "customer_no_courses", accessState: "queued", savedEmail: "a@x.com" }), "highlight", "ficha: campo disponible");

  console.log(fail === 0 ? "\nTIENDUP RETRY QUEUE OK" : `\n${fail} TEST(S) FALLARON`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
