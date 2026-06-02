import "server-only";

// ===========================================================================
// token-tracker.
//
// Normaliza el objeto `usage` que devuelve `messages.create()` del SDK de
// Anthropic a totales planos. Los tokens de cache (read + create) se
// contabilizan como tokens de entrada para el costo total.
// ===========================================================================

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Normaliza un objeto `usage` del SDK (forma Anthropic) a totales planos.
 * Los tokens de cache (lectura y creacion) se cuentan como tokens de entrada.
 * Es defensivo: tolera campos ausentes o cambios menores de forma del SDK.
 */
export function usageToTotals(usage: unknown): TokenTotals {
  const u = (usage ?? {}) as Record<string, unknown>;
  const inputTokens =
    num(u.input_tokens) +
    num(u.cache_read_input_tokens) +
    num(u.cache_creation_input_tokens);
  return { inputTokens, outputTokens: num(u.output_tokens) };
}

/** Suma dos pares de totales (util para acumular a lo largo de iteraciones). */
export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
