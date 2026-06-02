// ===========================================================================
// Harness de evals: corre el orquestador REAL (mismo prompt, mismo modelo,
// mismo armado) contra escenarios definidos en scenarios.ts.
//
// Comparte el armado del prompt con producción via prompt-builder.ts (single
// source of truth). Replica el parse de bloques + sanitizeStyle de
// orchestrator.ts y el fallback de derivación de run.ts, que son las dos
// piezas que viven en módulos server-only y no se pueden importar acá.
//
// NO cubre el loop del evaluator (eso es v2): evalúa lo que GENERA el
// orquestador, que es donde vive el comportamiento del prompt.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { getTimeContext } from "../../src/lib/agent/business-hours";
import { buildSystemPrompt, buildMessages } from "../../src/lib/agent/prompt-builder";
import { sanitizeStyle } from "../../src/lib/agent/sanitize";
import {
  NOTIFY_TEAM_TOOL_NAME,
  NOTIFY_TEAM_TOOL_SCHEMA,
  type NotifyTeamArgs,
} from "../../src/lib/agent/tools/notify_team";
import type { HistoryMessage } from "../../src/lib/agent/types";

// Igual que ORCHESTRATOR_MAX_TOKENS en orchestrator.ts (valor estable).
const MAX_TOKENS = 2048;

const PROMPTS_DIR = join(process.cwd(), "src", "lib", "agent", "prompts");
const ORCHESTRATOR_PROMPT = readFileSync(join(PROMPTS_DIR, "orchestrator.md"), "utf8");
const KNOWLEDGE_BASE = readFileSync(join(PROMPTS_DIR, "knowledge-base.md"), "utf8");

const MODEL = process.env.ANTHROPIC_MODEL_ORCHESTRATOR ?? "claude-sonnet-4-6";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Falta ANTHROPIC_API_KEY. Cargá .env.local (run.ts importa ./env primero).",
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface EvalTurnInput {
  history: HistoryMessage[];
  userMessage: string;
  now: Date;
  customerMessageCount: number;
  isExistingCustomer: boolean;
  priorEscalation: string | null;
}

export interface EvalTurnOutput {
  /** Texto final que vería el cliente (sanitizado, con fallback si aplica). */
  responseText: string;
  /** true si el orquestador llamó notify_team. */
  notified: boolean;
  /** Categoría de la notificación (o null). */
  category: string | null;
  /** Resuelto por el código (por la tarde / mañana / el lunes). */
  followUpTiming: string;
}

/**
 * Mirror de handoffFallbackNotice() en run.ts: cuando el orquestador deriva
 * sin generar texto, el cliente igual recibe un cierre positivo con timing.
 */
function handoffFallbackNotice(followUpTiming: string): string {
  return (
    "Buenísimo. Nuestro equipo se va a estar contactando con vos " +
    `${followUpTiming} para ayudarte con más detalle`
  );
}

/** Corre UN turno del orquestador real y devuelve lo que vería el cliente. */
export async function runOrchestratorEval(
  input: EvalTurnInput,
): Promise<EvalTurnOutput> {
  const timeContext = getTimeContext(input.now);

  const system = buildSystemPrompt({
    orchestratorPrompt: ORCHESTRATOR_PROMPT,
    knowledgeBase: KNOWLEDGE_BASE,
    timeContext,
    customerMessageCount: input.customerMessageCount,
    isExistingCustomer: input.isExistingCustomer,
    priorEscalation: input.priorEscalation,
  });

  const messages = buildMessages({
    userMessage: input.userMessage,
    history: input.history,
    evaluatorFeedback: null,
  });

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages,
    tools: [NOTIFY_TEAM_TOOL_SCHEMA],
  });

  // Mirror del parse de orchestrator.ts: acumular texto + detectar notify_team.
  let responseText = "";
  let notified = false;
  let category: string | null = null;
  for (const block of response.content) {
    if (block.type === "text") {
      responseText += (responseText ? "\n" : "") + block.text;
    } else if (block.type === "tool_use" && block.name === NOTIFY_TEAM_TOOL_NAME) {
      const args = block.input as NotifyTeamArgs;
      notified = true;
      category = args.category;
    }
  }

  const sanitized = sanitizeStyle(responseText.trim());

  // Mirror de run.ts: si derivó sin texto, el cliente igual recibe el cierre.
  const visible =
    notified && !sanitized ? handoffFallbackNotice(timeContext.followUpTiming) : sanitized;

  return {
    responseText: visible,
    notified,
    category,
    followUpTiming: timeContext.followUpTiming,
  };
}
