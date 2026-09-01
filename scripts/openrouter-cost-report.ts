// Costo REAL del agente vía OpenRouter para un período, sin precios hardcodeados.
//
// Los precios se leen en vivo de /api/v1/models (incluidos los de lectura y
// escritura de cache, que son los que mueven la aguja) y los tokens salen de
// agent_trace_steps. El total se cruza contra el contador de uso de la propia
// key de OpenRouter, que es el número que factura.
//
// OJO con el 13/08: recién desde ahí guardamos el desglose de cache. Para los
// días anteriores el script informa un RANGO, porque no sabemos qué parte del
// input se cobró como escritura de cache (1.25x).
//
//   NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2) \
//   SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2) \
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/openrouter-cost-report.ts 2026-08-01 2026-09-01
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY;
const CLIENT = process.env.CLIENT_SLUG ?? "vanesaruas";
// Desde esta fecha (inclusive) guardamos cache_read/write por step.
const CACHE_TRACKING_SINCE = "2026-08-13";

const [desde = "2026-08-01", hasta = "2026-09-01"] = process.argv.slice(2);
const usd = (n: number) => `$${n.toFixed(2)}`;

interface Pricing {
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Precios reales publicados por OpenRouter (USD por token). */
async function fetchPricing(): Promise<Record<string, Pricing>> {
  const r = await fetch("https://openrouter.ai/api/v1/models");
  const j = (await r.json()) as {
    data: { id: string; pricing: Record<string, string> }[];
  };
  const out: Record<string, Pricing> = {};
  for (const m of j.data) {
    out[m.id] = {
      prompt: Number(m.pricing.prompt ?? 0),
      completion: Number(m.pricing.completion ?? 0),
      cacheRead: Number(m.pricing.input_cache_read ?? m.pricing.prompt ?? 0),
      cacheWrite: Number(m.pricing.input_cache_write ?? m.pricing.prompt ?? 0),
    };
  }
  return out;
}

/** Uso real acumulado de la key (lo que OpenRouter efectivamente cobró). */
async function fetchKeyUsage() {
  const r = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${OR_KEY}` },
  });
  const j = (await r.json()) as {
    data?: { usage?: number; usage_monthly?: number; usage_weekly?: number };
  };
  return j.data ?? {};
}

/** Nuestro nombre de modelo, al slug de OpenRouter. */
function slugFor(model: string): string {
  const m = model.replace(/^openrouter:/, "");
  if (m.startsWith("anthropic/") || m.startsWith("openai/")) return m;
  if (/haiku/i.test(m)) return "anthropic/claude-haiku-4.5";
  if (/gpt-4o/i.test(m)) return "openai/gpt-4o";
  return "anthropic/claude-sonnet-4.5";
}

interface Row {
  dia: string;
  slug: string;
  steps: number;
  in: number;
  out: number;
  read: number;
  write: number;
}

/** Costo de una fila. Devuelve piso y techo (iguales si hay desglose real). */
function costOf(r: Row, p: Pricing): { lo: number; hi: number } {
  const salida = r.out * p.completion;
  if (r.dia >= CACHE_TRACKING_SINCE && (r.read || r.write)) {
    const fresco = Math.max(0, r.in - r.read - r.write);
    const c = fresco * p.prompt + r.read * p.cacheRead + r.write * p.cacheWrite + salida;
    return { lo: c, hi: c };
  }
  // Sin desglose: piso = todo el input a precio pleno; techo = todo como
  // escritura de cache (1.25x), que es lo que pasaba cuando el breakpoint
  // quedaba al final del prompt y se reescribía en cada llamada.
  return { lo: r.in * p.prompt + salida, hi: r.in * p.cacheWrite + salida };
}

async function main() {
  if (!URL || !KEY || !OR_KEY) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENROUTER_API_KEY",
    );
    process.exit(1);
  }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const pricing = await fetchPricing();

  // Steps del período, paginados (son decenas de miles de filas).
  const rows: Row[] = [];
  const byDay = new Map<string, Row>();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("agent_trace_steps")
      .select(
        "created_at, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens",
      )
      .eq("client_slug", CLIENT)
      .in("step_type", ["orchestrator", "evaluator"])
      .gte("created_at", `${desde}T03:00:00Z`)
      .lt("created_at", `${hasta}T03:00:00Z`)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const s of data) {
      // Día en hora de Argentina (UTC-3).
      const dia = new Date(new Date(s.created_at).getTime() - 3 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      const slug = slugFor(s.model ?? "");
      const k = `${dia}|${slug}`;
      let row = byDay.get(k);
      if (!row) {
        row = { dia, slug, steps: 0, in: 0, out: 0, read: 0, write: 0 };
        byDay.set(k, row);
        rows.push(row);
      }
      row.steps++;
      row.in += s.input_tokens ?? 0;
      row.out += s.output_tokens ?? 0;
      row.read += s.cache_read_tokens ?? 0;
      row.write += s.cache_write_tokens ?? 0;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  rows.sort((a, b) =>
    a.dia === b.dia ? a.slug.localeCompare(b.slug) : a.dia.localeCompare(b.dia),
  );

  let min = 0,
    max = 0,
    steps = 0,
    tokIn = 0,
    tokOut = 0,
    read = 0,
    write = 0;
  const porModelo = new Map<string, { min: number; max: number; steps: number }>();

  console.log(`\n=== Costo OpenRouter · ${CLIENT} · ${desde} a ${hasta} (exclusivo) ===\n`);
  console.log("dia         modelo                          steps      input     output  cache   costo");
  for (const r of rows) {
    const p = pricing[r.slug];
    if (!p) {
      console.error(`  (sin precio para ${r.slug}, se omite)`);
      continue;
    }
    const { lo, hi } = costOf(r, p);
    min += lo;
    max += hi;
    steps += r.steps;
    tokIn += r.in;
    tokOut += r.out;
    read += r.read;
    write += r.write;
    const acc = porModelo.get(r.slug) ?? { min: 0, max: 0, steps: 0 };
    acc.min += lo;
    acc.max += hi;
    acc.steps += r.steps;
    porModelo.set(r.slug, acc);

    const hit = r.in ? `${Math.round((r.read / r.in) * 100)}%` : "-";
    const costo = lo === hi ? usd(lo) : `${usd(lo)} a ${usd(hi)}`;
    console.log(
      `${r.dia}  ${r.slug.padEnd(30)} ${String(r.steps).padStart(5)} ${String(r.in).padStart(10)} ${String(r.out).padStart(10)} ${hit.padStart(6)}   ${costo}`,
    );
  }

  console.log(`\n--- Por modelo`);
  for (const [slug, a] of [...porModelo].sort((x, y) => y[1].max - x[1].max)) {
    const c = a.min === a.max ? usd(a.min) : `${usd(a.min)} a ${usd(a.max)}`;
    console.log(`  ${slug.padEnd(30)} ${String(a.steps).padStart(5)} steps   ${c}`);
  }

  console.log(`\n--- Totales del período`);
  console.log(`  Llamadas al modelo (steps): ${steps.toLocaleString()}`);
  console.log(`  Tokens de entrada:  ${tokIn.toLocaleString()}`);
  console.log(`  Tokens de salida:   ${tokOut.toLocaleString()}`);
  console.log(`  Leídos del cache:   ${read.toLocaleString()} · escritos: ${write.toLocaleString()}`);
  console.log(`  COSTO: ${min === max ? usd(min) : `entre ${usd(min)} y ${usd(max)}`}`);

  const k = await fetchKeyUsage();
  console.log(`\n--- Contador real de OpenRouter (toda la vida de la key)`);
  console.log(`  usage total:   ${usd(k.usage ?? 0)}`);
  console.log(`  usage mensual: ${usd(k.usage_monthly ?? 0)} · semanal: ${usd(k.usage_weekly ?? 0)}`);
  console.log(
    `\n  Nota: el contador es de la key entera, no del período pedido, y no incluye\n` +
      `  la lectura de comprobantes y títulos con vision, que va directo a Anthropic.`,
  );
}

void main();
