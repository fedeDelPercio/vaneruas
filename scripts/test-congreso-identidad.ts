// Evals de los dos ajustes nuevos: (1) el Congreso SIEMPRE es seña + saldo,
// nunca se paga el total por adelantado; (2) si la persona cree que habla con
// Vanesa, Valentina se identifica en el momento.
//
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/test-congreso-identidad.ts
import { readFileSync } from "node:fs";
import { toOpenAIBody, fromOpenAIResponse, type OpenAIResponse } from "../src/lib/agent/llm-translate";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("Falta OPENROUTER_API_KEY en el entorno.");
  process.exit(1);
}
const MODEL = process.env.OPENROUTER_MODEL_PRIMARY || "anthropic/claude-sonnet-4.5";
const orq = readFileSync("src/lib/agent/prompts/orchestrator.md", "utf8");
const kb = readFileSync("src/lib/agent/prompts/knowledge-base.md", "utf8");

const CASOS = [
  {
    nombre: "Congreso: dice que pago el total con tarjeta (caso Monica, 13/08)",
    historial: [] as { role: "user" | "assistant"; content: string }[],
    mensaje:
      "Hola que tal vanesa. Te consulto, cual es el valor total de la entrada entonces? Por que yo por la pagina pague el total de la entrada con tarjeta de credito. Tengo que llegar al congreso y abonar mas??",
  },
  {
    nombre: "Identidad: saluda a Vanesa con la conversacion ya empezada",
    historial: [
      { role: "user" as const, content: "Hola, consulta por el congreso" },
      { role: "assistant" as const, content: "Hola! Soy Valentina, la asistente IA de Vanesa Rúas Formación Profesional 👋 En que te puedo ayudar?" },
      { role: "user" as const, content: "Gracias!" },
      { role: "assistant" as const, content: "De nada! Cualquier cosa acá estoy 🤍" },
    ],
    mensaje: "Hola Vane! Che, una pregunta, el certificado del congreso es digital o impreso?",
  },
  {
    nombre: "Masterclass: pago unico, no debe saldo",
    historial: [] as { role: "user" | "assistant"; content: string }[],
    mensaje:
      "Hola! Pague la masterclass de higiene facial en 3 cuotas con tarjeta. Me queda algo por pagar despues?",
  },
];

async function main() {
  console.log(`Evals · modelo ${MODEL}\n`);
  for (const c of CASOS) {
    const params: MessageCreateParamsNonStreaming = {
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      system: [
        { type: "text", text: `${orq}\n\n# BASE DE CONOCIMIENTO\n\n${kb}`, cache_control: { type: "ephemeral" } },
        { type: "text", text: "=== Contexto de horario ===\nAhora es jueves 13/08/2026 16:40 (hora de Argentina)." },
      ],
      messages: [...c.historial, { role: "user", content: c.mensaje }],
    };
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(toOpenAIBody(params, MODEL)),
    });
    const json = (await res.json()) as OpenAIResponse & { error?: unknown };
    if (!res.ok) {
      console.error(`${c.nombre}: HTTP ${res.status}`, JSON.stringify(json.error).slice(0, 200));
      continue;
    }
    const { content } = fromOpenAIResponse(json);
    const texto = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    console.log(`--- ${c.nombre}`);
    console.log(`Clienta: ${c.mensaje}\n`);
    console.log(`${texto}\n`);
  }
}
void main();
