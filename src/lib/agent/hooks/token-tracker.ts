import "server-only";

// ===========================================================================
// token-tracker.
//
// Normaliza el objeto `usage` que devuelve `messages.create()` del SDK de
// Anthropic a totales planos. Los tokens de cache (read + create) se
// contabilizan como tokens de entrada para el costo total.
// ===========================================================================

export interface TokenTotals {
  /** Total de entrada: tokens frescos + leídos del cache + escritos al cache. */
  inputTokens: number;
  outputTokens: number;
  /** Parte de `inputTokens` que salió del prompt cache (se cobra 0.1x). */
  cacheReadTokens: number;
  /** Parte de `inputTokens` que se escribió al prompt cache (se cobra 1.25x). */
  cacheWriteTokens: number;
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
  const cacheReadTokens = num(u.cache_read_input_tokens);
  const cacheWriteTokens = num(u.cache_creation_input_tokens);
  return {
    inputTokens: num(u.input_tokens) + cacheReadTokens + cacheWriteTokens,
    outputTokens: num(u.output_tokens),
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/** Suma dos pares de totales (util para acumular a lo largo de iteraciones). */
export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
