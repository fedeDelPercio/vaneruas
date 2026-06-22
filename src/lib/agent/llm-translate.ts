// ===========================================================================
// Traducción de requests/responses entre el formato Anthropic (Messages API) y
// el formato OpenAI (Chat Completions, que usa OpenRouter). Lógica PURA, sin
// `server-only` ni env: así se puede unit-testear sin red ni DB
// (scripts/test-llm-translate.ts). La usa el fallback en `llm-call.ts`.
// ===========================================================================

import type {
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
  ToolChoice,
} from "@anthropic-ai/sdk/resources/messages";

export interface LlmContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface LlmUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface OpenAIResponse {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAIBody {
  model: string;
  max_tokens?: number;
  messages: { role: string; content: string }[];
  tools?: unknown[];
  tool_choice?: unknown;
}

/** Arma el body OpenAI (para OpenRouter) a partir de los params Anthropic. */
export function toOpenAIBody(
  params: MessageCreateParamsNonStreaming,
  model: string,
): OpenAIBody {
  const body: OpenAIBody = {
    model,
    max_tokens: params.max_tokens,
    messages: toOpenAIMessages(params),
  };
  if (params.tools?.length) body.tools = toOpenAITools(params.tools as Tool[]);
  if (params.tool_choice) body.tool_choice = toOpenAIToolChoice(params.tool_choice);
  return body;
}

/** System (string o array de bloques) + mensajes → mensajes formato OpenAI. */
export function toOpenAIMessages(
  params: MessageCreateParamsNonStreaming,
): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  const sys = systemToString(params.system);
  if (sys) out.push({ role: "system", content: sys });
  for (const m of params.messages) {
    out.push({ role: m.role, content: messageContentToString(m.content) });
  }
  return out;
}

export function systemToString(
  system: MessageCreateParamsNonStreaming["system"],
): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system
    .map((b) => (typeof b === "string" ? b : b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

export function messageContentToString(content: MessageParam["content"]): string {
  if (typeof content === "string") return content;
  // Array de bloques: juntamos el texto (los 2 call sites solo usan text).
  return content
    .map((b) => {
      if (typeof b === "string") return b;
      return b.type === "text" ? b.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function toOpenAITools(tools: Tool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export function toOpenAIToolChoice(tc: ToolChoice): unknown {
  if (tc.type === "tool" && tc.name) {
    return { type: "function", function: { name: tc.name } };
  }
  if (tc.type === "any") return "required";
  return "auto";
}

/** Respuesta OpenAI (OpenRouter) → bloques estilo Anthropic (text / tool_use). */
export function fromOpenAIResponse(
  json: OpenAIResponse,
): { content: LlmContentBlock[]; usage: LlmUsage; stop_reason: string | null } {
  const choice = json.choices?.[0];
  const msg = choice?.message ?? {};
  const content: LlmContentBlock[] = [];
  if (typeof msg.content === "string" && msg.content.trim()) {
    content.push({ type: "text", text: msg.content });
  }
  for (const tc of msg.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: tc.id ?? `tool_${content.length}`,
      name: tc.function?.name,
      input: safeParseJson(tc.function?.arguments),
    });
  }
  return {
    content,
    usage: {
      input_tokens: json.usage?.prompt_tokens,
      output_tokens: json.usage?.completion_tokens,
    },
    stop_reason: choice?.finish_reason ?? null,
  };
}

export function safeParseJson(s: string | undefined): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * ¿Conviene caer al fallback ante este error? Sí para caídas/sobrecargas de la
 * API (5xx, 429) y errores de red/timeout (sin status). NO para 4xx de request
 * (400/401/403/404/422): ahí el problema es nuestro o de config y OpenRouter
 * fallaría igual; mejor que el error suba.
 */
export function isFallbackWorthy(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return true;
}
