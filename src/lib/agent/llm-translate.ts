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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /**
     * Desglose del prompt caching. OpenRouter lo devuelve acá para los modelos
     * Anthropic. `prompt_tokens` YA INCLUYE estos tokens (convención OpenAI),
     * a diferencia de Anthropic directo donde `input_tokens` los excluye.
     */
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    };
  };
}

/** Parte de texto en formato OpenAI, con el breakpoint de cache opcional. */
export interface OpenAITextPart {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface OpenAIMessage {
  role: string;
  /** String plano si no hay breakpoints; array de partes si los hay. */
  content: string | OpenAITextPart[];
}

export interface OpenAIBody {
  model: string;
  max_tokens?: number;
  messages: OpenAIMessage[];
  tools?: unknown[];
  tool_choice?: unknown;
  /** Prompt caching automático de OpenRouter (ver toOpenAIBody). */
  cache_control?: { type: "ephemeral" };
}

/** Arma el body OpenAI (para OpenRouter) a partir de los params Anthropic. */
export function toOpenAIBody(
  params: MessageCreateParamsNonStreaming,
  model: string,
): OpenAIBody {
  // `cache_control` es específico de Anthropic. Para el modelo de último
  // recurso (GPT) aplanamos a string plano, como antes.
  const isAnthropic = model.startsWith("anthropic/");
  const messages = isAnthropic
    ? toOpenAIMessages(params)
    : toOpenAIMessages(params).map((m) => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.map((p) => p.text).join("\n")
          : m.content,
      }));
  const body: OpenAIBody = {
    model,
    max_tokens: params.max_tokens,
    messages,
  };
  if (params.tools?.length) body.tools = toOpenAITools(params.tools as Tool[]);
  if (params.tool_choice) body.tool_choice = toOpenAIToolChoice(params.tool_choice);
  // Prompt caching: para modelos Claude, OpenRouter NO cachea solo (a diferencia
  // de los modelos OpenAI). Hay dos formas de pedirlo y NO son equivalentes:
  //
  //   1. Breakpoints explícitos (`cache_control` en una parte del contenido):
  //      el cache corta JUSTO ahí, así que todo lo que viene después puede
  //      cambiar sin invalidarlo. Es lo que necesitamos: el prompt del
  //      orquestador/evaluator es [prompts + KB estable][contexto variable].
  //   2. `cache_control` top-level: OpenRouter ubica el breakpoint por su
  //      cuenta, al final del prompt. Sirve cuando el prompt entero se repite
  //      igual, pero con cualquier cola variable (el mensaje del cliente) el
  //      hit es siempre 0. Medido en vivo: dos llamadas idénticas cachean, dos
  //      llamadas con distinto mensaje final no.
  //
  // Por eso, si los callers marcaron breakpoints (los preserva
  // `toOpenAIMessages`), mandamos SOLO esos. El top-level queda como red de
  // seguridad para requests sin marcar.
  if (isAnthropic && !hasCacheBreakpoint(messages)) {
    body.cache_control = { type: "ephemeral" };
  }
  return body;
}

function hasCacheBreakpoint(messages: OpenAIMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.cache_control),
  );
}

/**
 * System (string o array de bloques) + mensajes → mensajes formato OpenAI,
 * preservando los `cache_control` que hayan puesto los callers.
 */
export function toOpenAIMessages(
  params: MessageCreateParamsNonStreaming,
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  const sys = systemToParts(params.system);
  if (sys.length) out.push({ role: "system", content: collapse(sys) });
  for (const m of params.messages) {
    out.push({ role: m.role, content: collapse(contentToParts(m.content)) });
  }
  return out;
}

/**
 * Si ninguna parte tiene breakpoint, devolvemos un string plano (body más
 * chico y compatible con cualquier modelo, incluidos los que no son Anthropic).
 * Si alguna lo tiene, conservamos el array.
 */
function collapse(parts: OpenAITextPart[]): string | OpenAITextPart[] {
  if (parts.some((p) => p.cache_control)) return parts;
  return parts.map((p) => p.text).join("\n");
}

export function systemToParts(
  system: MessageCreateParamsNonStreaming["system"],
): OpenAITextPart[] {
  if (!system) return [];
  if (typeof system === "string") return [{ type: "text", text: system }];
  return system
    .map((b): OpenAITextPart | null => {
      if (typeof b === "string") return { type: "text", text: b };
      if (b.type !== "text" || !b.text) return null;
      return b.cache_control
        ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } }
        : { type: "text", text: b.text };
    })
    .filter((p): p is OpenAITextPart => Boolean(p?.text));
}

export function contentToParts(content: MessageParam["content"]): OpenAITextPart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  // Array de bloques: los 2 call sites solo usan text.
  return content
    .map((b): OpenAITextPart | null => {
      if (typeof b === "string") return { type: "text", text: b };
      if (b.type !== "text" || !b.text) return null;
      return b.cache_control
        ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } }
        : { type: "text", text: b.text };
    })
    .filter((p): p is OpenAITextPart => Boolean(p?.text));
}

/** Texto plano de un `system` (para logs / compatibilidad). */
export function systemToString(
  system: MessageCreateParamsNonStreaming["system"],
): string {
  return systemToParts(system)
    .map((p) => p.text)
    .join("\n\n");
}

export function messageContentToString(content: MessageParam["content"]): string {
  return contentToParts(content)
    .map((p) => p.text)
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
  // Normalizamos el usage a la forma Anthropic, que es la que consume
  // `usageToTotals`. Ojo con la diferencia de convención: en formato OpenAI
  // `prompt_tokens` es el TOTAL (incluye lo cacheado), mientras que en Anthropic
  // `input_tokens` es solo lo fresco y el cache va aparte. Si copiáramos
  // `prompt_tokens` tal cual y además sumáramos el cache, contaríamos doble.
  const promptTokens = json.usage?.prompt_tokens;
  const details = json.usage?.prompt_tokens_details;
  const cacheRead = details?.cached_tokens ?? 0;
  const cacheWrite = details?.cache_write_tokens ?? 0;
  const fresh =
    typeof promptTokens === "number"
      ? Math.max(0, promptTokens - cacheRead - cacheWrite)
      : undefined;

  return {
    content,
    usage: {
      input_tokens: fresh,
      output_tokens: json.usage?.completion_tokens,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
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
