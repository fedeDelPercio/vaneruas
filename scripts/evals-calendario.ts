// Evals de punta a punta del calendario "Planificá tu verano": cada caso pasa
// por el orquestador REAL (prompt + base de conocimiento + ficha en vivo) y
// después por el evaluator REAL, como en producción. Lo del evaluator importa:
// si rechaza tres veces seguidas, el sistema deriva solo al equipo, así que una
// respuesta perfecta del orquestador igual puede terminar en una derivación.
//
//   NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2) \
//   SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2) \
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/evals-calendario.ts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { toOpenAIBody, fromOpenAIResponse, type OpenAIResponse } from "../src/lib/agent/llm-translate";
// Import directo: el barrel de tools trae `server-only`.
import { NOTIFY_TEAM_TOOL_SCHEMA } from "../src/lib/agent/tools/notify_team";
import { sanitizeStyle } from "../src/lib/agent/sanitize";
import { plazosBlock } from "../src/lib/agent/plazos";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const KEY = process.env.OPENROUTER_API_KEY!;
const MODEL = process.env.OPENROUTER_MODEL_PRIMARY ?? "anthropic/claude-sonnet-4.5";

const orq = readFileSync("src/lib/agent/prompts/orchestrator.md", "utf8");
const kb = readFileSync("src/lib/agent/prompts/knowledge-base.md", "utf8");
const evaluatorPrompt = readFileSync("src/lib/agent/prompts/evaluator.md", "utf8");

interface Caso {
  n: string;
  /** Fecha simulada, para probar los cortes del 9/11, el 25/11 y el 28/11. */
  hoy: Date;
  m: string;
  /** null = primer mensaje de la conversación. */
  previo?: string;
  espera: string;
}

const d = (iso: string) => new Date(iso);

const CASOS: Caso[] = [
  { n: "Pide el calendario (primer mensaje)", hoy: d("2026-11-06T15:00:00-03:00"), m: "Hola! quiero el calendario", espera: "Se presenta y manda el link en la misma respuesta, sin preguntar nada" },
  { n: "Pide el calendario (conversación ya empezada)", hoy: d("2026-11-06T15:00:00-03:00"), previo: "Cliente: hola\nAsesor: Hola! Soy Valentina, la asistente IA de Vanesa Rúas Formación Profesional 👋 En qué te puedo ayudar?", m: "me pasas el calendario?", espera: "Link directo, con lo del lunes 9" },
  { n: "Pide el calendario después del 9/11", hoy: d("2026-11-12T10:00:00-03:00"), previo: "Cliente: hola\nAsesor: Hola! Soy Valentina 👋", m: "calendario", espera: "Link, SIN decir que la primera tarea es el lunes 9" },
  { n: "Cómo se usa", hoy: d("2026-11-06T15:00:00-03:00"), previo: "Cliente: quiero el calendario\nAsesor: Acá tenés el calendario 🎁", m: "y como se usa? no entiendo nada", espera: "Respuesta corta + remite al tutorial" },
  { n: "Pide el código antes del 25", hoy: d("2026-11-10T11:00:00-03:00"), previo: "Cliente: quiero el calendario\nAsesor: Acá tenés el calendario 🎁", m: "como desbloqueo diciembre? me pasas el codigo?", espera: "NO da código, explica que es en vivo el 28, link de inscripción" },
  { n: "Ya se anotó y pide el código", hoy: d("2026-11-15T11:00:00-03:00"), previo: "Cliente: hola\nAsesor: Hola! Soy Valentina 👋", m: "yo ya estoy anotada en la masterclass, me pasas el codigo para el calendario?", espera: "NO da código, se da en vivo el sábado 28" },
  { n: "Pide desbloquear después del 25 (cerró la inscripción)", hoy: d("2026-11-26T11:00:00-03:00"), previo: "Cliente: hola\nAsesor: Hola! Soy Valentina 👋", m: "como hago para tener diciembre del calendario?", espera: "NO comparte link de inscripción, noviembre sigue siendo suyo" },
  { n: "Hizo la clase y perdió el código", hoy: d("2026-11-30T10:00:00-03:00"), previo: "Cliente: hola\nAsesor: Hola! Soy Valentina 👋", m: "hice la masterclass pero no anote el codigo del calendario, me lo pasas?", espera: "NO da código, deriva con escalado_manual" },
  { n: "Sigue abierta la inscripción (antes del corte)", hoy: d("2026-11-20T18:00:00-03:00"), previo: "Cliente: quiero el calendario\nAsesor: Acá tenés el calendario 🎁", m: "y para desbloquear el resto todavia me puedo anotar?", espera: "Sí, cierra el miércoles 25 a las 21 hs, link de inscripción" },
  { n: "Etiquetas en recuadro", hoy: d("2026-11-06T15:00:00-03:00"), previo: "Cliente: quiero el calendario\nAsesor: Acá tenés el calendario 🎁", m: "que significan las palabras en mayuscula tipo NOMBRE y BENEFICIO?", espera: "Son etiquetas, se reemplazan" },
  { n: "Cuesta algo", hoy: d("2026-11-06T15:00:00-03:00"), previo: "Cliente: hola\nAsesor: Hola! Soy Valentina 👋", m: "el calendario es pago?", espera: "Es un regalo, noviembre gratis" },
  { n: "No le abre el link", hoy: d("2026-11-06T15:00:00-03:00"), previo: "Cliente: quiero el calendario\nAsesor: Acá tenés el calendario 🎁", m: "no me abre el link, queda en blanco", espera: "Navegador del celu, recargar, NO deriva todavía" },
  { n: "Pregunta fuera de lo cargado", hoy: d("2026-11-06T15:00:00-03:00"), previo: "Cliente: quiero el calendario\nAsesor: Acá tenés el calendario 🎁", m: "el calendario sirve tambien para depilacion laser?", espera: "No inventa: lo consulta con el equipo y deriva" },
];

const fmt = (dt: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires",
  }).format(dt);

async function eventsBlock(): Promise<string> {
  const { data } = await sb
    .from("events")
    .select("title, kind, event_at, event_end_at, details, landing_url")
    .eq("client_slug", "vanesaruas")
    .eq("status", "activo");
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
  const bloques = (data ?? []).map((e) =>
    [
      `## ${e.title} (${e.kind === "congress" ? "Congreso" : "Masterclass"})`,
      e.event_at ? `- **Fecha del evento:** ${e.event_end_at ? `del ${fecha(e.event_at)} al ${fecha(e.event_end_at)}` : fecha(e.event_at)}` : "",
      e.landing_url ? `- **Link de la web:** ${e.landing_url} (podés compartirlo si quiere ver más detalle)` : "",
      "",
      (e.details ?? "").trim(),
    ].filter(Boolean).join("\n"),
  );
  return [
    "# EVENTOS VIGENTES",
    "",
    "Estos son los eventos que podés comunicar ahora mismo, con sus precios y fechas actualizadas. Tienen prioridad sobre cualquier dato de evento más abajo en la base de conocimiento. Si un evento no figura acá, no lo ofrezcas todavía.",
    "",
    bloques.join("\n\n"),
  ].join("\n");
}

async function llamar(params: MessageCreateParamsNonStreaming) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(toOpenAIBody(params, MODEL)),
  });
  const j = (await r.json()) as OpenAIResponse & { error?: unknown };
  if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j.error).slice(0, 200)}`);
  return fromOpenAIResponse(j);
}

async function main() {
  const eventos = await eventsBlock();
  let pasaEvaluator = 0;
  console.log(`# Evals del calendario\n\nModelo ${MODEL}\n`);

  // SOLO="texto" corre solo los casos cuyo nombre lo contiene.
  const solo = process.env.SOLO?.toLowerCase();
  for (const c of CASOS.filter((x) => !solo || x.n.toLowerCase().includes(solo))) {
    const historial = c.previo ?? "(no hay mensajes previos, es el primer contacto)";
    const orqRes = await llamar({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: [
        { type: "text", text: `${orq}\n\n# BASE DE CONOCIMIENTO\n\n${kb}\n\n${eventos}`, cache_control: { type: "ephemeral" } },
        { type: "text", text: `=== Contexto de horario ===\nAhora es ${fmt(c.hoy)} (hora de Argentina).\n\n${plazosBlock(c.hoy)}\n\n=== Conversación previa ===\n${historial}` },
      ],
      messages: [{ role: "user", content: c.m }],
      tools: [NOTIFY_TEAM_TOOL_SCHEMA],
    });
    const texto = sanitizeStyle(
      orqRes.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
    );
    const notify = orqRes.content.find((b) => b.type === "tool_use" && b.name === "notify_team");
    const cat = notify ? (notify.input as { category?: string })?.category : null;

    // El evaluator recibe lo mismo que en producción: KB + eventos primero.
    const evRes = await llamar({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      system: [{ type: "text", text: evaluatorPrompt }],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `=== BASE DE CONOCIMIENTO (única fuente válida para afirmaciones de producto) ===\n${kb}\n\n${eventos}`,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: [
                "Validá la siguiente respuesta del asesor ANTES de que llegue al cliente.",
                "",
                `=== Fecha de hoy ===\nHoy es ${fmt(c.hoy)} (hora de Argentina).\n\n${plazosBlock(c.hoy)}`,
                "",
                `=== Conversación previa ===\n${historial}`,
                "",
                `=== Mensaje del cliente (el que se está respondiendo ahora) ===\n${c.m}`,
                "",
                `=== Respuesta propuesta por el asesor ===\n${texto || "(respuesta vacía)"}`,
                "",
                "Devolvé tu veredicto invocando la tool `evaluation_result`.",
              ].join("\n"),
            },
          ],
        },
      ],
      tools: [
        {
          name: "evaluation_result",
          description: "Reporta el veredicto.",
          input_schema: {
            type: "object",
            properties: {
              pass: { type: "boolean" },
              failedCriteria: { type: "array", items: { type: "string" } },
              suggestion: { type: "string" },
            },
            required: ["pass", "failedCriteria", "suggestion"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "evaluation_result" },
    });
    const v = (evRes.content.find((b) => b.type === "tool_use")?.input ?? {}) as {
      pass?: boolean;
      suggestion?: string;
    };
    if (v.pass) pasaEvaluator++;

    console.log(`## ${c.n}  ·  ${fmt(c.hoy)}`);
    console.log(`\n**Clienta:** ${c.m}\n\n**Valentina:**\n`);
    for (const parte of texto.split(/\n\s*---\s*\n/)) console.log(`> ${parte.replace(/\n/g, "\n> ")}\n`);
    console.log(`**Deriva:** ${notify ? `sí (${cat})` : "no"}  ·  **Evaluator:** ${v.pass ? "aprueba" : `RECHAZA · ${v.suggestion ?? ""}`}`);
    console.log(`**Esperado:** ${c.espera}\n`);
  }
  console.log(`\nEvaluator aprobó ${pasaEvaluator}/${CASOS.filter((x) => !solo || x.n.toLowerCase().includes(solo)).length}`);
}

void main();
