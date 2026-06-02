// ===========================================================================
// env loader del harness de evals (side-effect, sin exports).
//
// Carga `.env.local` en process.env ANTES de que harness.ts instancie el
// cliente de Anthropic. Tiene que ser el PRIMER import del entry point
// (run.ts) por el orden de evaluación de los imports hoisteados.
//
// A diferencia del loader del wa-bot, NO necesita stubear `server-only`:
// el harness importa solo módulos puros (prompt-builder, business-hours,
// sanitize, notify_team), ninguno con `import "server-only"`.
// ===========================================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");

if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf-8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
  console.log(`[eval] env cargado desde ${envPath}`);
} else {
  console.warn(`[eval] .env.local no encontrado en ${envPath}, uso variables del sistema`);
}
