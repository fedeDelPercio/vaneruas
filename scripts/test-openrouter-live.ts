// Smoke-test EN VIVO del fallback de OpenRouter: confirma que la API key y los
// slugs de modelo funcionan, y que nuestra traducción produce un body que
// OpenRouter acepta y devuelve algo parseable.
//
// Correr (sin exponer la key en el comando):
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/test-openrouter-live.ts
import { toOpenAIBody, fromOpenAIResponse, type OpenAIResponse } from "../src/lib/agent/llm-translate";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("Falta OPENROUTER_API_KEY en el entorno.");
  process.exit(1);
}

const MODELS = [
  process.env.OPENROUTER_MODEL_PRIMARY || "anthropic/claude-sonnet-4.5",
  process.env.OPENROUTER_MODEL_FALLBACK || "openai/gpt-4o",
];

// Request mínimo estilo orquestador (system + user, sin tools).
const params: MessageCreateParamsNonStreaming = {
  model: "claude-sonnet-4-6",
  max_tokens: 64,
  system: [{ type: "text", text: "Respondé en español rioplatense, una sola línea, sin emojis." }],
  messages: [{ role: "user", content: "Decime una frase corta de bienvenida para una formación en estética." }],
};

async function main() {
let fail = 0;
for (const model of MODELS) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vaneruas.vercel.app",
        "X-Title": "ATP Vanesa Ruas",
      },
      body: JSON.stringify(toOpenAIBody(params, model)),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      fail++;
      console.error(`FAIL  ${model} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const json = (await res.json()) as OpenAIResponse;
    const out = fromOpenAIResponse(json);
    const text = out.content.find((b) => b.type === "text")?.text ?? "";
    if (text.trim()) {
      console.log(`  ok  ${model} -> "${text.trim()}" (in:${out.usage.input_tokens} out:${out.usage.output_tokens})`);
    } else {
      fail++;
      console.error(`FAIL  ${model} -> respondió sin texto`, JSON.stringify(json).slice(0, 200));
    }
  } catch (err) {
    fail++;
    console.error(`FAIL  ${model} ->`, err instanceof Error ? err.message : String(err));
  }
}

console.log(fail === 0 ? "\nOPENROUTER OK" : `\n${fail} MODELO(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
}

void main();
