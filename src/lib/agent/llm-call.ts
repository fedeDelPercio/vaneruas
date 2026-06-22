import "server-only";

import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient } from "./llm-client";
import { serverEnv } from "@/lib/env";
import {
  fromOpenAIResponse,
  isFallbackWorthy,
  toOpenAIBody,
  type LlmContentBlock,
  type LlmUsage,
  type OpenAIResponse,
} from "./llm-translate";

// ===========================================================================
// Llamada conversacional con fallback de proveedor (Plan B ante caída de Claude).
//
// El camino crítico del agente (orchestrator + evaluator) NO puede quedarse sin
// responder si la API de Anthropic está caída/sobrecargada. Esta función intenta
// una cascada:
//   1. Anthropic directo (camino normal, mismo comportamiento de siempre).
//   2. Claude vía OpenRouter (mismo modelo, pero OpenRouter puede rutear por
//      proveedores alternativos —Bedrock/Vertex— si la API directa se cae).
//   3. Un modelo de último recurso vía OpenRouter (ej. GPT) ante una caída total
//      de Claude en todos los proveedores.
//
// Recibe los MISMOS params que `messages.create()` de Anthropic y devuelve una
// respuesta NORMALIZADA con la forma que consumen orchestrator/evaluator
// (`content` de bloques text/tool_use + `usage`). La traducción de formato
// (Anthropic ↔ OpenAI) vive en `llm-translate.ts` (pura, testeada).
//
// El fallback es transparente: si no hay OPENROUTER_API_KEY, se comporta igual
// que antes (Anthropic directo, y si falla, lanza). La vision/OCR de comprobantes
// NO usa esto a propósito (ya falla-soft; el equipo valida a mano).
// ===========================================================================

export interface LlmResponse {
  content: LlmContentBlock[];
  usage: LlmUsage | null;
  stop_reason?: string | null;
  /** Proveedor que efectivamente respondió (para el trace). */
  provider: "anthropic" | "openrouter";
  /** Modelo que efectivamente respondió. */
  model: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 45000;

/**
 * Llama al modelo conversacional con fallback de proveedor. `params` es el mismo
 * objeto que se le pasaría a `getAnthropicClient().messages.create()`. `signal`
 * solo aplica al intento de Anthropic (los intentos de OpenRouter usan su propio
 * timeout para tener una chance justa aunque el signal del caller ya esté vencido).
 */
export async function createConversationMessage(
  params: MessageCreateParamsNonStreaming,
  opts: { signal?: AbortSignal } = {},
): Promise<LlmResponse> {
  const env = serverEnv();

  // 1. Anthropic directo (camino normal).
  try {
    const r = await getAnthropicClient().messages.create(params, { signal: opts.signal });
    return {
      content: r.content as unknown as LlmContentBlock[],
      usage: r.usage as unknown as LlmUsage,
      stop_reason: r.stop_reason,
      provider: "anthropic",
      model: params.model,
    };
  } catch (err) {
    if (!isFallbackWorthy(err)) throw err;
    console.error("[llm] Anthropic falló, intentando OpenRouter:", describeError(err));
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic falló y no hay OPENROUTER_API_KEY configurada para el fallback",
    );
  }

  // 2 + 3. Cascada de modelos en OpenRouter (Claude primero, último recurso después).
  const cascade = [env.OPENROUTER_MODEL_PRIMARY, env.OPENROUTER_MODEL_FALLBACK].filter(
    (m): m is string => Boolean(m && m.trim()),
  );
  if (cascade.length === 0) {
    throw new Error(
      "Anthropic falló y no hay modelos de OpenRouter configurados (OPENROUTER_MODEL_PRIMARY / OPENROUTER_MODEL_FALLBACK)",
    );
  }

  let lastErr: unknown = null;
  for (const model of cascade) {
    try {
      const r = await callOpenRouter(params, model, apiKey);
      console.warn(`[llm] respondió OpenRouter (${model}) tras caída de Anthropic`);
      return r;
    } catch (err) {
      lastErr = err;
      console.error(`[llm] OpenRouter (${model}) falló:`, describeError(err));
    }
  }
  throw lastErr ?? new Error("Fallback de OpenRouter agotado");
}

async function callOpenRouter(
  params: MessageCreateParamsNonStreaming,
  model: string,
  apiKey: string,
): Promise<LlmResponse> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter recomienda estos headers para atribución (opcionales).
      "HTTP-Referer": "https://vaneruas.vercel.app",
      "X-Title": "ATP Vanesa Ruas",
    },
    body: JSON.stringify(toOpenAIBody(params, model)),
    signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = (await res.json()) as OpenAIResponse;
  const out = fromOpenAIResponse(json);
  return { ...out, provider: "openrouter", model };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
