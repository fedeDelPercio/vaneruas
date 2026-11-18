import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { clientEnv, serverEnv } from "@/lib/env";
import { createConversationMessage } from "@/lib/agent/llm-call";
import { reportedCost, usageToTotals } from "@/lib/agent/hooks/token-tracker";
import {
  buildTranscript,
  buildUserPrompt,
  CRITICAL_SYSTEM_PROMPT,
  isMissingColumnError,
  nextCriticalState,
  parseCriticalResponse,
  parseEnabledFlag,
  shouldEvaluate,
  type ClassifierMessage,
} from "./classifier";

// ===========================================================================
// Evaluación "Crítico" de una conversación (la corre el worker de jobs una vez
// por turno de la contacta, en modo IA y en modo Humano).
//
// Nunca lanza: un fallo del modelo, de la base o la migración 034 sin aplicar
// se loguea (sin texto de la conversación ni datos personales) y el job sigue.
// ===========================================================================

const CLASSIFIER_TIMEOUT_MS = 20_000;
const CLASSIFIER_MAX_TOKENS = 150;
// Se traen más mensajes que los que van al modelo: los adjuntos y carteles se
// descartan y tienen que quedar ~10 con texto.
const FETCH_MESSAGES = 30;

export function criticalClassifierEnabled(): boolean {
  return parseEnabledFlag(serverEnv().CRITICAL_CLASSIFIER_ENABLED);
}

export async function evaluateConversationCritical(conversationId: string): Promise<void> {
  try {
    if (!criticalClassifierEnabled()) return;
    const sb = getSupabaseServerClient();
    const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;

    const { data: conv, error: convErr } = await sb
      .from("conversations")
      .select("id, source, critical, critical_at, critical_evaluated_at")
      .eq("id", conversationId)
      .eq("client_slug", slug)
      .maybeSingle();
    if (convErr) {
      if (isMissingColumnError(convErr)) {
        console.warn("[critical] falta la migración 034 (columnas critical_*): no se evalúa");
      } else {
        console.error("[critical] no se pudo leer la conversación:", convErr.message);
      }
      return;
    }
    if (!conv || conv.source !== "whatsapp") return;

    const { data: rows, error: msgErr } = await sb
      .from("messages")
      .select("role, content, attachment_path, created_at")
      .eq("conversation_id", conversationId)
      .eq("client_slug", slug)
      .order("created_at", { ascending: false })
      .limit(FETCH_MESSAGES);
    if (msgErr) {
      console.error("[critical] no se pudieron leer los mensajes:", msgErr.message);
      return;
    }
    const messages = (rows ?? []) as ClassifierMessage[];
    const lastInboundAt = messages.find((m) => m.role === "user")?.created_at ?? null;
    if (!shouldEvaluate({ lastInboundAt, evaluatedAt: conv.critical_evaluated_at ?? null })) return;

    const transcript = buildTranscript(messages);
    // Solo adjuntos (comprobante, título): nada que juzgar, no se gasta una llamada.
    const hasCustomerText = transcript.split("\n\n").some((l) => l.startsWith("Contacta:"));
    if (!hasCustomerText) {
      await sb
        .from("conversations")
        .update({ critical_evaluated_at: lastInboundAt })
        .eq("id", conversationId)
        .eq("client_slug", slug);
      return;
    }

    const model = serverEnv().CRITICAL_CLASSIFIER_MODEL;
    const started = Date.now();
    const response = await createConversationMessage(
      {
        model,
        max_tokens: CLASSIFIER_MAX_TOKENS,
        temperature: 0,
        system: CRITICAL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(transcript) }],
      },
      { signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS) },
    );
    const text = response.content
      .map((b) => (b.type === "text" ? (b as { text?: string }).text ?? "" : ""))
      .join("");
    const verdict = parseCriticalResponse(text);
    const totals = usageToTotals(response.usage);
    const cost = reportedCost(response.usage);
    // Registro de costo y uso, sin contenido: id de conversación, modelo, tokens.
    console.info(
      `[critical] conv=${conversationId} provider=${response.provider} model=${response.model} ` +
        `in=${totals.inputTokens} out=${totals.outputTokens} cost_usd=${cost ?? "n/d"} ` +
        `ms=${Date.now() - started} result=${verdict ? String(verdict.critical) : "invalido"}`,
    );
    if (!verdict) return; // respuesta inválida: se reintenta con el próximo mensaje

    const patch = nextCriticalState(
      { critical: conv.critical ?? null, criticalAt: conv.critical_at ?? null },
      verdict,
      lastInboundAt as string,
    );
    const { error: upErr } = await sb
      .from("conversations")
      .update(patch)
      .eq("id", conversationId)
      .eq("client_slug", slug);
    if (upErr) {
      console.error(
        isMissingColumnError(upErr)
          ? "[critical] falta la migración 034 (columnas critical_*): no se guardó"
          : `[critical] no se pudo guardar: ${upErr.message}`,
      );
    }
  } catch (err) {
    console.error("[critical] falló el clasificador:", err instanceof Error ? err.name : "error");
  }
}
