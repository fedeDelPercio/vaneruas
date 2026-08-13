// Reporte de costo OPERATIVO del agente (tokens + estimación en USD) para
// vanesaruas, a partir de agent_traces / agent_trace_steps.
//
//   NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2) \
//   SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/cost-report.ts
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Precios por 1M tokens (USD). Ajustar si cambian los modelos en prod.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-opus-4-6": { in: 5, out: 25 },
};
// Fallback aproximado para modelos no mapeados (ej. openrouter:*).
const DEFAULT_PRICE = { in: 3, out: 15 };

// Multiplicadores del prompt caching (Anthropic, TTL 5 min): leer del cache
// cuesta 0.1x el input normal, escribirlo 1.25x.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

function priceFor(model: string) {
  const base = model.replace(/^openrouter:/, "").replace(/-\d{8}$/, "");
  return PRICING[base] ?? DEFAULT_PRICE;
}
const usd = (n: number) => `$${n.toFixed(2)}`;

async function main() {
  if (!URL || !KEY) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // 1) Conversaciones de vanesaruas.
  const { data: convs } = await sb
    .from("conversations")
    .select("id")
    .eq("client_slug", "vanesaruas");
  const convIds = (convs ?? []).map((c) => c.id);
  console.log(`Conversaciones vanesaruas: ${convIds.length}`);
  if (!convIds.length) return;

  // 2) Traces (corridas del agente) de esas conversaciones.
  const traceIds: string[] = [];
  let tracesIn = 0,
    tracesOut = 0,
    tracesCount = 0;
  const byStatus: Record<string, number> = {};
  for (let i = 0; i < convIds.length; i += 50) {
    const batch = convIds.slice(i, i + 50);
    const { data } = await sb
      .from("agent_traces")
      .select("id, status, total_input_tokens, total_output_tokens")
      .in("conversation_id", batch);
    for (const t of data ?? []) {
      traceIds.push(t.id);
      tracesIn += t.total_input_tokens ?? 0;
      tracesOut += t.total_output_tokens ?? 0;
      tracesCount++;
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    }
  }
  console.log(`\nCorridas del agente (traces): ${tracesCount}`);
  console.log("  por estado:", byStatus);
  console.log(`  tokens (trace-level): in ${tracesIn.toLocaleString()} · out ${tracesOut.toLocaleString()}`);

  // 3) Steps por modelo (para precificar bien orquestador vs evaluador vs fallback).
  // `input_tokens` es el TOTAL de entrada; `cache_read/write` son el desglose de
  // cuánto de ese total salió del prompt cache. Lo fresco es la resta.
  type Bucket = { in: number; out: number; read: number; write: number; steps: number };
  const byModel: Record<string, Bucket> = {};
  for (let i = 0; i < traceIds.length; i += 100) {
    const batch = traceIds.slice(i, i + 100);
    const { data } = await sb
      .from("agent_trace_steps")
      .select("model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens")
      .in("trace_id", batch);
    for (const s of data ?? []) {
      const m = s.model ?? "desconocido";
      const b = (byModel[m] ??= { in: 0, out: 0, read: 0, write: 0, steps: 0 });
      b.in += s.input_tokens ?? 0;
      b.out += s.output_tokens ?? 0;
      b.read += s.cache_read_tokens ?? 0;
      b.write += s.cache_write_tokens ?? 0;
      b.steps++;
    }
  }

  console.log(`\n=== Costo estimado por modelo (USD) ===`);
  let totalUsd = 0,
    totIn = 0,
    totOut = 0,
    totRead = 0,
    sinCacheUsd = 0;
  for (const [model, b] of Object.entries(byModel).sort((a, b) => b[1].in - a[1].in)) {
    const p = priceFor(model);
    const fresh = Math.max(0, b.in - b.read - b.write);
    const cost =
      (fresh / 1e6) * p.in +
      (b.read / 1e6) * p.in * CACHE_READ_MULT +
      (b.write / 1e6) * p.in * CACHE_WRITE_MULT +
      (b.out / 1e6) * p.out;
    // Contrafáctico: lo mismo pagando todo el input a precio pleno.
    sinCacheUsd += (b.in / 1e6) * p.in + (b.out / 1e6) * p.out;
    totalUsd += cost;
    totIn += b.in;
    totOut += b.out;
    totRead += b.read;
    const hit = b.in ? Math.round((b.read / b.in) * 100) : 0;
    console.log(
      `  ${model}: ${b.steps} steps · in ${b.in.toLocaleString()} (cache ${hit}%) · out ${b.out.toLocaleString()} · ${usd(cost)}`,
    );
  }
  const hitRate = totIn ? Math.round((totRead / totIn) * 100) : 0;
  console.log(`\n  TOTAL steps: in ${totIn.toLocaleString()} · out ${totOut.toLocaleString()}`);
  console.log(`  Cache hit: ${hitRate}% del input (${totRead.toLocaleString()} tokens a 0.1x)`);
  console.log(`  COSTO TOTAL ESTIMADO (conversacional): ${usd(totalUsd)}`);
  console.log(`  Sin prompt caching habría sido: ${usd(sinCacheUsd)} (ahorro ${usd(sinCacheUsd - totalUsd)})`);
  console.log(
    `\nNota: NO incluye la lectura de comprobantes/títulos con vision (classify/extract),\n` +
      `que hace llamadas directas a Claude sin registrarse en los traces.`,
  );
}

void main();
