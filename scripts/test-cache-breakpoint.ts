// Dónde hay que poner el breakpoint de cache para que OpenRouter lo respete.
// Manda el MISMO prefijo estable con DOS colas variables distintas y mide si la
// segunda llamada lee del cache. Si el breakpoint funciona, la segunda tiene que
// leer ~el prefijo entero aunque la cola cambie.
//
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/test-cache-breakpoint.ts
import { readFileSync } from "node:fs";
import { toOpenAIBody, fromOpenAIResponse, type OpenAIResponse } from "../src/lib/agent/llm-translate";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("Falta OPENROUTER_API_KEY en el entorno.");
  process.exit(1);
}
const MODEL = "anthropic/claude-sonnet-4.5";
const kb = readFileSync("src/lib/agent/prompts/knowledge-base.md", "utf8");
const evalPrompt = readFileSync("src/lib/agent/prompts/evaluator.md", "utf8");

/** Variante A: KB dentro del mensaje del usuario, con breakpoint. */
function enUser(cola: string): MessageCreateParamsNonStreaming {
  return {
    model: "claude-sonnet-4-5",
    max_tokens: 32,
    system: [{ type: "text", text: evalPrompt }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `=== KB ===\n${kb}`, cache_control: { type: "ephemeral" } },
          { type: "text", text: cola },
        ],
      },
    ],
  };
}

/** Variante B: KB dentro del system, con breakpoint (como el orquestador). */
function enSystem(cola: string): MessageCreateParamsNonStreaming {
  return {
    model: "claude-sonnet-4-5",
    max_tokens: 32,
    system: [
      {
        type: "text",
        text: `${evalPrompt}\n\n=== KB ===\n${kb}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: cola }],
  };
}

async function call(params: MessageCreateParamsNonStreaming) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(toOpenAIBody(params, MODEL)),
  });
  const json = (await res.json()) as OpenAIResponse & { error?: unknown };
  if (!res.ok) {
    console.log(`    HTTP ${res.status} ${JSON.stringify(json.error).slice(0, 160)}`);
    return null;
  }
  const { usage } = fromOpenAIResponse(json);
  return usage;
}

async function probar(nombre: string, build: (cola: string) => MessageCreateParamsNonStreaming) {
  console.log(`\n${nombre}`);
  // Cola 1: siembra el cache. Cola 2: distinta, mide si el prefijo igual pega.
  // Colas deliberadamente distintas en contenido Y en largo, como pasa en
  // producción (cada conversación tiene otro historial y otro mensaje).
  const u1 = await call(build("Validá: la clase se ve hasta el 21. Respondé OK."));
  const u2 = await call(
    build(
      [
        "=== Fecha de hoy ===",
        "Hoy es martes 11/08/2026 11:17 (hora de Argentina).",
        "=== Conversación previa ===",
        "Cliente: Hola, mi correo es nora@gmail.com",
        "Asesor: Gracias, queda registrado",
        "Cliente: queria saber si ya esta el grupo de wsap porque no estoy yo",
        "=== Respuesta propuesta ===",
        "Hola! El link del grupo te llega por correo electrónico, revisá spam y promociones",
        "Respondé OK.",
      ].join("\n"),
    ),
  );
  if (!u1 || !u2) return;
  console.log(`  siembra : read ${u1.cache_read_input_tokens} · write ${u1.cache_creation_input_tokens} · fresco ${u1.input_tokens}`);
  console.log(`  cola nueva: read ${u2.cache_read_input_tokens} · write ${u2.cache_creation_input_tokens} · fresco ${u2.input_tokens}`);
  console.log(
    (u2.cache_read_input_tokens ?? 0) > 1000
      ? "  => SIRVE: el prefijo pega aunque cambie la cola"
      : "  => NO SIRVE: con la cola distinta el cache no pega",
  );
}

/** Variante C: igual que A pero con tools + tool_choice (como el evaluator real). */
function enUserConTools(cola: string): MessageCreateParamsNonStreaming {
  return {
    ...enUser(cola),
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
  };
}

async function main() {
  await probar("A) breakpoint en el mensaje del usuario", enUser);
  await probar("B) breakpoint en el system", enSystem);
  await probar("C) en el usuario + tools (forma real del evaluator)", enUserConTools);
}

void main();
