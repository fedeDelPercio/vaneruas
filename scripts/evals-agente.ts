// Evals del agente contra el prompt REAL de producción (orquestador + base de
// conocimiento + ficha del evento en vivo desde la tabla `events`) y con las
// mismas tools, así se ve cuándo deriva de verdad.
//
// Los casos salen de lo que más consultaron en el último mes según
// agent_notifications, escritos como escribe la gente (sin tildes, corridos).
//
//   NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2) \
//   SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2) \
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/evals-agente.ts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  toOpenAIBody,
  fromOpenAIResponse,
  type OpenAIResponse,
} from "../src/lib/agent/llm-translate";
// Import directo al archivo del schema: el barrel `tools/index.ts` trae
// `server-only` y no se puede importar desde un script.
import { NOTIFY_TEAM_TOOL_SCHEMA } from "../src/lib/agent/tools/notify_team";
import { sanitizeStyle } from "../src/lib/agent/sanitize";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const KEY = process.env.OPENROUTER_API_KEY!;
const MODEL = process.env.OPENROUTER_MODEL_PRIMARY ?? "anthropic/claude-sonnet-4.5";
const AHORA = "viernes 11/09/2026 19:00";

const orq = readFileSync("src/lib/agent/prompts/orchestrator.md", "utf8");
const kb = readFileSync("src/lib/agent/prompts/knowledge-base.md", "utf8");

interface Caso {
  n: string;
  m: string;
  espera: string;
}

const CASOS: Caso[] = [
  { n: "Manda comprobante de peelings", m: "Hola buenas noches! Envio comprobante de la masterclass de peelings de verano. Sofia Lioni, chopimetica@gmail.com", espera: "Lo recibe normal. NUNCA decir que no hay inscripciones abiertas" },
  { n: "Quiere anotarse", m: "Hola! Me quiero anotar a la masterclass de peelings de verano, todavia puedo?", espera: "Si, inscripciones abiertas" },
  { n: "Pregunta el precio", m: "Cuanto sale la masterclass de peelings de verano?", espera: "Deriva, no inventa precio" },
  { n: "Pregunta la fecha", m: "Que dia es la masterclass de peelings de verano?", espera: "Deriva, no inventa fecha" },
  { n: "Afirma una fecha (no debe confirmarla)", m: "Es para la masterclass de peeling de verano que se dicta el 28/11 no?", espera: "NO confirma el 28/11 como oficial, deriva" },
  { n: "Control: grabacion masterclass vieja", m: "Puedo ver todavia la grabacion de higiene facial?", espera: "Vencio el 21/08" },
];

async function eventsBlock(): Promise<string> {
  const { data } = await sb
    .from("events")
    .select("title, kind, event_at, event_end_at, details, landing_url")
    .eq("client_slug", "vanesaruas")
    .eq("status", "activo");
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date(iso));
  const bloques = (data ?? []).map((e) =>
    [
      `## ${e.title} (${e.kind === "congress" ? "Congreso" : "Masterclass"})`,
      e.event_at
        ? `- **Fecha del evento:** ${e.event_end_at ? `del ${fecha(e.event_at)} al ${fecha(e.event_end_at)}` : fecha(e.event_at)}`
        : "",
      e.landing_url ? `- **Link de la web:** ${e.landing_url} (podés compartirlo si quiere ver más detalle)` : "",
      "",
      (e.details ?? "").trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "# EVENTOS VIGENTES",
    "",
    "Estos son los eventos que podés comunicar ahora mismo, con sus precios y fechas actualizadas. Tienen prioridad sobre cualquier dato de evento más abajo en la base de conocimiento. Si un evento no figura acá, no lo ofrezcas todavía.",
    "",
    bloques.join("\n\n"),
  ].join("\n");
}

async function main() {
  const eventos = await eventsBlock();
  console.log(`# Evals del Congreso\n\nModelo ${MODEL} · ahora simulado: ${AHORA}\n`);

  for (const c of CASOS) {
    const params: MessageCreateParamsNonStreaming = {
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: `${orq}\n\n# BASE DE CONOCIMIENTO\n\n${kb}\n\n${eventos}`,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: `=== Contexto de horario ===\nAhora es ${AHORA} (hora de Argentina).\n\n=== Estado del contacto ===\nEsta persona YA ES CLIENTA (ya pagó o acreditó su título).`,
        },
      ],
      messages: [{ role: "user", content: c.m }],
      tools: [NOTIFY_TEAM_TOOL_SCHEMA],
    };
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(toOpenAIBody(params, MODEL)),
    });
    const j = (await r.json()) as OpenAIResponse & { error?: unknown };
    if (!r.ok) {
      console.error(`## ${c.n}\n\nHTTP ${r.status} ${JSON.stringify(j.error).slice(0, 200)}\n`);
      continue;
    }
    const res = fromOpenAIResponse(j);
    // sanitizeStyle es lo que corre en produccion antes de enviar (saca el
    // **bold**, el punto final y demas), asi el eval muestra el texto real.
    const texto = sanitizeStyle(
      res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim(),
    );
    const notify = res.content.find((b) => b.type === "tool_use" && b.name === "notify_team");
    const cat = notify ? (notify.input as { category?: string })?.category : null;

    console.log(`## ${c.n}`);
    console.log(`\n**Clienta:** ${c.m}\n`);
    console.log(`**Valentina:**\n`);
    for (const parte of texto.split(/\n\s*---\s*\n/)) console.log(`> ${parte.replace(/\n/g, "\n> ")}\n`);
    console.log(`**Deriva:** ${notify ? `sí (${cat})` : "no"}`);
    console.log(`**Esperado:** ${c.espera}\n`);
  }
}

void main();
