// Test determinístico de la traducción Anthropic ↔ OpenAI del fallback.
// Correr con: npx tsx scripts/test-llm-translate.ts
import {
  fromOpenAIResponse,
  isFallbackWorthy,
  toOpenAIBody,
} from "../src/lib/agent/llm-translate";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  ok  " + name);
  else {
    fail++;
    console.error("FAIL  " + name, extra ?? "");
  }
}

// --- 1. Request del orquestador (system array + tools, sin tool_choice) ------
{
  const params: MessageCreateParamsNonStreaming = {
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: [
      { type: "text", text: "Sos el agente.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Contexto dinámico." },
    ],
    messages: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola, cómo estás?" },
      { role: "user", content: "info del congreso" },
    ],
    tools: [
      {
        name: "notify_team",
        description: "Deriva al equipo",
        input_schema: { type: "object", properties: { reason: { type: "string" } } },
      },
    ],
  };
  const body = toOpenAIBody(params, "anthropic/claude-sonnet-4.5");
  ok("orq: modelo override", body.model === "anthropic/claude-sonnet-4.5");
  ok("orq: max_tokens", body.max_tokens === 2048);
  ok("orq: system juntado como 1er mensaje", body.messages[0]?.role === "system" &&
    body.messages[0]?.content === "Sos el agente.\n\nContexto dinámico.", body.messages[0]);
  ok("orq: 3 mensajes + system = 4", body.messages.length === 4, body.messages.length);
  ok("orq: user/assistant en orden", body.messages[1]?.role === "user" &&
    body.messages[3]?.role === "user" && body.messages[3]?.content === "info del congreso");
  ok("orq: tool traducida a function", Array.isArray(body.tools) && body.tools.length === 1 &&
    (body.tools[0] as { type: string; function: { name: string } }).type === "function" &&
    (body.tools[0] as { function: { name: string } }).function.name === "notify_team", body.tools);
  ok("orq: sin tool_choice → auto (omitido)", body.tool_choice === undefined);
}

// --- 2. Request del evaluator (system string-ish, content array, tool_choice forzado) ---
{
  const params: MessageCreateParamsNonStreaming = {
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: [{ type: "text", text: "Sos el evaluador." }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "parte variable" },
          { type: "text", text: "base de conocimiento", cache_control: { type: "ephemeral" } },
        ],
      },
    ],
    tools: [
      { name: "evaluation_result", description: "veredicto", input_schema: { type: "object" } },
    ],
    tool_choice: { type: "tool", name: "evaluation_result" },
  };
  const body = toOpenAIBody(params, "openai/gpt-4o");
  ok("eval: content array juntado", body.messages[1]?.content === "parte variable\nbase de conocimiento",
    body.messages[1]);
  ok("eval: tool_choice forzado a function", JSON.stringify(body.tool_choice) ===
    JSON.stringify({ type: "function", function: { name: "evaluation_result" } }), body.tool_choice);
}

// --- 3. Response OpenAI con texto puro → bloque text ------------------------
{
  const r = fromOpenAIResponse({
    choices: [{ finish_reason: "stop", message: { content: "Hola, gracias por escribir" } }],
    usage: { prompt_tokens: 1200, completion_tokens: 40 },
  });
  ok("resp texto: 1 bloque text", r.content.length === 1 && r.content[0]?.type === "text" &&
    r.content[0]?.text === "Hola, gracias por escribir", r.content);
  ok("resp texto: usage mapeado", r.usage.input_tokens === 1200 && r.usage.output_tokens === 40, r.usage);
}

// --- 4. Response OpenAI con tool_call → bloque tool_use con input parseado ---
{
  const r = fromOpenAIResponse({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [{
          id: "call_1",
          function: { name: "evaluation_result", arguments: '{"pass":true,"failedCriteria":[],"suggestion":null}' },
        }],
      },
    }],
    usage: { prompt_tokens: 800, completion_tokens: 20 },
  });
  const tb = r.content.find((b) => b.type === "tool_use");
  ok("resp tool: hay tool_use", Boolean(tb), r.content);
  ok("resp tool: name correcto", tb?.name === "evaluation_result");
  ok("resp tool: input parseado a objeto", (tb?.input as { pass?: boolean })?.pass === true, tb?.input);
}

// --- 5. tool_call con arguments malformados → input {} (no rompe) -----------
{
  const r = fromOpenAIResponse({
    choices: [{ message: { tool_calls: [{ id: "x", function: { name: "t", arguments: "{roto" } }] } }],
  });
  const tb = r.content.find((b) => b.type === "tool_use");
  ok("resp tool malformado: input = {}", JSON.stringify(tb?.input) === "{}", tb?.input);
}

// --- 6. isFallbackWorthy: 5xx/429/red sí; 4xx no ----------------------------
{
  ok("fallback: 500 sí", isFallbackWorthy({ status: 500 }));
  ok("fallback: 529 (overloaded) sí", isFallbackWorthy({ status: 529 }));
  ok("fallback: 429 sí", isFallbackWorthy({ status: 429 }));
  ok("fallback: error de red (sin status) sí", isFallbackWorthy(new Error("fetch failed")));
  ok("fallback: 400 no", !isFallbackWorthy({ status: 400 }));
  ok("fallback: 401 no", !isFallbackWorthy({ status: 401 }));
  ok("fallback: 404 no", !isFallbackWorthy({ status: 404 }));
}

console.log(fail === 0 ? "\nTODOS OK" : `\n${fail} FALLARON`);
process.exit(fail === 0 ? 0 : 1);
