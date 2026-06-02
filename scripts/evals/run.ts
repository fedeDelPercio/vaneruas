// ===========================================================================
// Entry point del harness de evals.
//
//   npm run eval            -> corre todos los escenarios
//   npm run eval -- <texto> -> corre solo los que matcheen ese texto en el nombre
//
// IMPORTANTE: `import "./env"` tiene que ser el PRIMER import (carga
// .env.local antes de que harness.ts instancie el cliente de Anthropic).
// ===========================================================================

import "./env";

import { runOrchestratorEval } from "./harness";
import { checkExpect } from "./assert";
import { SCENARIOS, type Scenario } from "./scenarios";
import type { HistoryMessage } from "../../src/lib/agent/types";

function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

async function runScenario(sc: Scenario): Promise<{ asserts: number; failed: number }> {
  console.log(`\n━━━ ${sc.name}`);
  const history: HistoryMessage[] = [];
  let priorEscalation: string | null = null;
  let asserts = 0;
  let failed = 0;

  for (const turn of sc.turns) {
    const customerMessageCount =
      history.filter((m) => m.role === "user").length + 1;

    const out = await runOrchestratorEval({
      history,
      userMessage: turn.user,
      now: new Date(sc.now),
      customerMessageCount,
      isExistingCustomer: sc.isExistingCustomer ?? false,
      priorEscalation,
    });

    console.log(`\n  >> ${turn.user}`);
    console.log(indent(out.responseText, "  << "));
    if (out.notified) console.log(`     [notify_team: ${out.category}]`);

    if (turn.expect) {
      asserts++;
      const failures = checkExpect(out, turn.expect);
      if (failures.length === 0) {
        console.log("     PASS");
      } else {
        failed++;
        for (const f of failures) console.log(`     FAIL: ${f}`);
      }
    }

    history.push({ role: "user", content: turn.user });
    history.push({ role: "assistant", content: out.responseText });
    if (out.notified && out.category) priorEscalation = out.category;
  }

  return { asserts, failed };
}

async function main(): Promise<void> {
  const filter = process.argv.slice(2).join(" ").trim().toLowerCase();
  const scenarios = filter
    ? SCENARIOS.filter((s) => s.name.toLowerCase().includes(filter))
    : SCENARIOS;

  if (scenarios.length === 0) {
    console.log(`No hay escenarios que matcheen "${filter}".`);
    process.exit(0);
  }

  console.log(
    `[eval] corriendo ${scenarios.length} escenario(s) contra el orquestador real\n`,
  );

  let totalAsserts = 0;
  let totalFailed = 0;
  for (const sc of scenarios) {
    const r = await runScenario(sc);
    totalAsserts += r.asserts;
    totalFailed += r.failed;
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    `Resultado: ${totalAsserts - totalFailed}/${totalAsserts} turnos con aserciones OK` +
      (totalFailed ? `, ${totalFailed} con fallas` : ""),
  );
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[eval] error fatal:", err);
  process.exit(1);
});
