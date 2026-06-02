import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Loader de los prompts del agente. Viven como archivos .md en esta carpeta
// para que el dev los edite sin tocar codigo. Se leen en runtime y se cachean
// en memoria por proceso.

export type PromptName = "orchestrator" | "evaluator" | "knowledge-base";

const cache = new Map<string, string>();
const PROMPTS_DIR = join(process.cwd(), "src", "lib", "agent", "prompts");

/** Devuelve el contenido del archivo .md indicado. */
export function loadPrompt(name: PromptName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const content = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");
  cache.set(name, content);
  return content;
}
