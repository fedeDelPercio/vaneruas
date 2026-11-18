// Tests determinísticos del tag "Crítico" y de las intervenciones automáticas.
// Sin red ni base: todo con fixtures y un cliente de Supabase falso.
// Correr con: npx tsx scripts/test-critical-classifier.ts
import {
  buildTranscript,
  buildUserPrompt,
  CRITICAL_SYSTEM_PROMPT,
  isMissingColumnError,
  MAX_REASON_CHARS,
  nextCriticalState,
  parseCriticalResponse,
  parseEnabledFlag,
  shouldEvaluate,
  withOptionalColumns,
  type ClassifierMessage,
} from "../src/lib/critical/classifier";
import {
  AGENT_HANDOFF_FILTER,
  HUMAN_WAITING_REASON,
  openHumanWaitingIntervention,
  resolveTeamInterventions,
} from "../src/lib/team-interventions";

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`, extra ?? "");
  }
}

const at = (min: number) => new Date(Date.UTC(2026, 10, 18, 12, min)).toISOString();
const msg = (role: string, min: number, content: string | null, attach = false): ClassifierMessage => ({
  role,
  content,
  created_at: at(min),
  attachment_path: attach ? "x/y.jpg" : null,
});

async function main() {
  // --- Parseo de la respuesta ----------------------------------------------
  console.log("parseCriticalResponse");
  {
    const v = parseCriticalResponse('{"critical": true, "reason": "Amenaza con denunciar"}');
    assert("JSON limpio", v?.critical === true && v.reason === "Amenaza con denunciar", v);
    const w = parseCriticalResponse('```json\n{"critical": false, "reason": "Consulta normal"}\n```');
    assert("JSON en bloque de código", w?.critical === false && w.reason === "Consulta normal", w);
    const x = parseCriticalResponse('Claro. {"critical":"true","reason":"  Enojo   explícito "} listo');
    assert("texto alrededor + string 'true' + espacios", x?.critical === true && x.reason === "Enojo explícito", x);
    const long = parseCriticalResponse(JSON.stringify({ critical: true, reason: "a".repeat(300) }));
    assert("motivo recortado a 120", (long?.reason.length ?? 0) <= MAX_REASON_CHARS, long?.reason.length);
    const empty = parseCriticalResponse('{"critical": true}');
    assert("crítico sin motivo → motivo por defecto", Boolean(empty?.critical && empty.reason), empty);
    assert("sin JSON → null", parseCriticalResponse("no sé") === null);
    assert("JSON roto → null", parseCriticalResponse('{"critical": tru') === null);
    assert("critical inválido → null", parseCriticalResponse('{"critical": "quizás"}') === null);
    assert("vacío → null", parseCriticalResponse("") === null && parseCriticalResponse(null) === null);
  }

  // --- Prompt --------------------------------------------------------------
  console.log("buildTranscript / prompt");
  {
    const msgs: ClassifierMessage[] = [
      msg("user", 1, "Hola, quiero info del curso"),
      msg("assistant", 2, "Hola! Te cuento\n---\nEl precio es X"),
      msg("system", 3, "Derivado al equipo: Escalado manual"),
      msg("user", 4, "[Adjunto: https://ghl/x.jpg]", true),
      msg("human", 5, "Te paso el link"),
      msg("user", 6, "TODAVIA NO ME LLEGA NADA, LOS VOY A DENUNCIAR"),
    ];
    const t = buildTranscript(msgs);
    assert("incluye a la contacta", t.includes("Contacta: TODAVIA NO ME LLEGA NADA"), t);
    assert("incluye a Valentina y al equipo", t.includes("Valentina (IA): Hola!") && t.includes("Equipo: Te paso el link"), t);
    assert("sin carteles de sistema", !t.includes("Derivado al equipo"), t);
    assert("sin adjuntos", !t.includes("Adjunto") && !t.includes("https://ghl"), t);
    assert("sin separadores ---", !t.includes("---"), t);
    assert("orden cronológico", t.indexOf("quiero info") < t.indexOf("DENUNCIAR"), t);

    const many = Array.from({ length: 25 }, (_, i) => msg("user", i, `mensaje ${i}`));
    const tl = buildTranscript(many);
    assert("solo los últimos 10", tl.split("\n\n").length === 10 && tl.includes("mensaje 24") && !tl.includes("mensaje 14"), tl);

    const desordenados = [msg("user", 9, "último"), msg("user", 1, "primero")];
    assert("ordena aunque vengan al revés", buildTranscript(desordenados).startsWith("Contacta: primero"));

    const clipped = buildTranscript([msg("user", 1, "x".repeat(2000))]);
    assert("recorta mensajes larguísimos", clipped.length < 700, clipped.length);

    const up = buildUserPrompt(t);
    assert("prompt de usuario lleva la conversación y pide JSON", up.includes(t) && /JSON/.test(up));
    assert("system prompt pide el formato", CRITICAL_SYSTEM_PROMPT.includes('"critical"') && CRITICAL_SYSTEM_PROMPT.includes("120"));
    assert("system prompt excluye comprobantes y apuro amable", /comprobantes/.test(CRITICAL_SYSTEM_PROMPT) && /apuro amable/.test(CRITICAL_SYSTEM_PROMPT));
  }

  // --- Decisión de re-evaluar ----------------------------------------------
  console.log("shouldEvaluate");
  {
    assert("sin mensajes de la contacta → no", !shouldEvaluate({ lastInboundAt: null, evaluatedAt: null }));
    assert("nunca evaluada → sí", shouldEvaluate({ lastInboundAt: at(5), evaluatedAt: null }));
    assert("inbound nuevo → sí", shouldEvaluate({ lastInboundAt: at(6), evaluatedAt: at(5) }));
    assert("mismo inbound → no", !shouldEvaluate({ lastInboundAt: at(5), evaluatedAt: at(5) }));
    assert("evaluada después → no", !shouldEvaluate({ lastInboundAt: at(4), evaluatedAt: at(5) }));
  }

  // --- Estado a guardar ----------------------------------------------------
  console.log("nextCriticalState");
  {
    const now = new Date(at(30));
    const on = nextCriticalState({ critical: null, criticalAt: null }, { critical: true, reason: "Enojo" }, at(10), now);
    assert("prende con motivo y fecha", on.critical === true && on.critical_reason === "Enojo" && on.critical_at === now.toISOString() && on.critical_evaluated_at === at(10), on);
    const keep = nextCriticalState({ critical: true, criticalAt: at(1) }, { critical: true, reason: "Sigue" }, at(10), now);
    assert("ya crítica: conserva critical_at", keep.critical_at === at(1), keep);
    const off = nextCriticalState({ critical: true, criticalAt: at(1) }, { critical: false, reason: "Calma" }, at(10), now);
    assert("no apaga solo (lo apaga el equipo)", !("critical" in off) && off.critical_evaluated_at === at(10), off);
  }

  // --- Flag y degradación sin columnas ---------------------------------------
  console.log("flag + degradación");
  {
    assert("flag apagado por defecto", !parseEnabledFlag(undefined) && !parseEnabledFlag("") && !parseEnabledFlag("false"));
    assert("flag prendido con true/1/on", parseEnabledFlag("true") && parseEnabledFlag("1") && parseEnabledFlag(" ON "));
    assert("42703 = columna faltante", isMissingColumnError({ code: "42703", message: "column conversations.critical does not exist" }));
    assert("PGRST204 = columna faltante", isMissingColumnError({ code: "PGRST204", message: "Could not find the 'critical' column of 'conversations' in the schema cache" }));
    assert("otro error no", !isMissingColumnError({ code: "57014", message: "timeout" }) && !isMissingColumnError(null));

    const calls: string[] = [];
    const missingDb = async (cols: string) => {
      calls.push(cols);
      return cols.includes("critical")
        ? { data: null, error: { code: "42703", message: "column conversations.critical does not exist" } }
        : { data: [{ id: "c1" }], error: null };
    };
    const r1 = await withOptionalColumns(missingDb, "id", ", critical", true);
    assert("sin migración: reintenta sin las columnas", r1.missing && r1.res.error === null && calls.length === 2 && calls[1] === "id", { r1, calls });
    calls.length = 0;
    const r2 = await withOptionalColumns(missingDb, "id", ", critical", false);
    assert("recordado: un solo pedido sin las columnas", !r2.missing && calls.length === 1 && calls[0] === "id", calls);
    calls.length = 0;
    const okDb = async (cols: string) => {
      calls.push(cols);
      return { data: [{ id: "c1", critical: true }], error: null };
    };
    const r3 = await withOptionalColumns(okDb, "id", ", critical", true);
    assert("con migración: un pedido con las columnas", !r3.missing && calls.length === 1 && calls[0] === "id, critical", calls);
    const otherErr = async () => ({ data: null, error: { code: "57014", message: "timeout" } });
    const r4 = await withOptionalColumns(otherErr, "id", ", critical", true);
    assert("otro error se devuelve tal cual", !r4.missing && r4.res.error?.code === "57014");
  }

  // --- Intervenciones automáticas (cliente falso) ------------------------------
  console.log("team-interventions");
  {
    assert(
      "el agente excluye tiendup_* y humano_sin_respuesta",
      AGENT_HANDOFF_FILTER.includes("tiendup_*") && AGENT_HANDOFF_FILTER.includes(`reason.neq.${HUMAN_WAITING_REASON}`),
      AGENT_HANDOFF_FILTER,
    );

    type Call = { op: string; args: unknown[] };
    function fakeDb(result: { data: unknown; error: unknown }, calls: Call[]) {
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "update", "insert", "eq", "is", "not", "or", "lt", "limit"]) {
        builder[op] = (...args: unknown[]) => {
          calls.push({ op, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return { from: (table: string) => (calls.push({ op: "from", args: [table] }), builder) };
    }

    const calls: Call[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = fakeDb({ data: [{ id: "n1" }, { id: "n2" }], error: null }, calls) as any;
    const r = await resolveTeamInterventions(db, {
      conversationId: "conv-1",
      clientSlug: "vanesaruas",
      resolvedBy: null,
      before: at(10),
    });
    const has = (op: string, pred: (a: unknown[]) => boolean) => calls.some((c) => c.op === op && pred(c.args));
    assert("resuelve y cuenta", r.resolved === 2 && r.error === null, r);
    assert("filtra client_slug explícito", has("eq", (a) => a[0] === "client_slug" && a[1] === "vanesaruas"));
    assert("solo abiertas", has("is", (a) => a[0] === "resolved_at" && a[1] === null));
    assert("excluye validacion_pago y reclamo_certificado", has("not", (a) => a[0] === "category" && String(a[2]).includes("validacion_pago") && String(a[2]).includes("reclamo_certificado")));
    assert("excluye tiendup_*", has("or", (a) => String(a[0]).includes("tiendup_*")));
    assert("solo anteriores al mensaje del equipo", has("lt", (a) => a[0] === "created_at" && a[1] === at(10)));
    assert("resolved_by null desde GHL", has("update", (a) => (a[0] as Record<string, unknown>).resolved_by === null));

    const callsOpen: Call[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbOpen = fakeDb({ data: [{ id: "ya" }], error: null }, callsOpen) as any;
    const o = await openHumanWaitingIntervention(dbOpen, { conversationId: "conv-1", clientSlug: "vanesaruas" });
    assert("ya hay una abierta → no duplica", !o.opened && !callsOpen.some((c) => c.op === "insert"), o);

    const callsNew: Call[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbNew = fakeDb({ data: [], error: null }, callsNew) as any;
    const n = await openHumanWaitingIntervention(dbNew, { conversationId: "conv-1", clientSlug: "vanesaruas" });
    const ins = callsNew.find((c) => c.op === "insert")?.args[0] as Record<string, unknown> | undefined;
    assert("sin abiertas → inserta una", n.opened && Boolean(ins), n);
    assert(
      "categoría existente + marca + slug",
      ins?.category === "escalado_manual" && ins?.reason === HUMAN_WAITING_REASON && ins?.client_slug === "vanesaruas",
      ins,
    );

    const callsErr: Call[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbErr = fakeDb({ data: null, error: { message: "boom" } }, callsErr) as any;
    const e = await openHumanWaitingIntervention(dbErr, { conversationId: "conv-1", clientSlug: "vanesaruas" });
    assert("error de lectura → no inserta ni lanza", !e.opened && e.error === "boom" && !callsErr.some((c) => c.op === "insert"));
  }

  console.log(failures ? `\n${failures} fallaron` : "\nTodo ok");
  process.exit(failures ? 1 : 0);
}

void main();
