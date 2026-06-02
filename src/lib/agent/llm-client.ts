import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";

// ===========================================================================
// Cliente de la API de Anthropic (modo directo, sin Agent SDK).
//
// Reemplaza la dependencia previa a @anthropic-ai/claude-agent-sdk, que
// spawneaba un binario nativo y no funciona en Vercel serverless. La SDK
// regular (@anthropic-ai/sdk) usa HTTP directo y corre en cualquier runtime
// de Node.
// ===========================================================================

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY });
  return cached;
}
