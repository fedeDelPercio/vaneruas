// Replay del evaluator sobre casos REALES que rechazó en producción, con el
// armado nuevo (KB adelante + fecha + historial, en Sonnet). Sirve para
// confirmar que dejamos de rechazar respuestas correctas sin volvernos
// permisivos con las que sí estaban mal.
//
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/test-evaluator-replay.ts
import { readFileSync } from "node:fs";
import { toOpenAIBody, fromOpenAIResponse, type OpenAIResponse } from "../src/lib/agent/llm-translate";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("Falta OPENROUTER_API_KEY en el entorno.");
  process.exit(1);
}

const MODEL = process.env.OPENROUTER_MODEL_PRIMARY || "anthropic/claude-sonnet-4.5";
const kb = readFileSync("src/lib/agent/prompts/knowledge-base.md", "utf8");
const evaluatorPrompt = readFileSync("src/lib/agent/prompts/evaluator.md", "utf8");

interface Caso {
  nombre: string;
  hoy: string;
  historial: string;
  mensaje: string;
  respuesta: string;
  /** Qué esperamos ahora. */
  esperado: "pass" | "fail";
}

const CASOS: Caso[] = [
  {
    nombre: "¿se puede ver una sola vez? (rechazado 07/08, era correcta)",
    hoy: "jueves 07/08/2026 13:22",
    historial: "(no hay mensajes previos, es el primer contacto)",
    mensaje: "Hola!!! Te hago una consulta… la clase se puede ver por la plataforma una sola vez???",
    respuesta:
      "Hola! No, la podés ver las veces que quieras mientras esté disponible (hasta el viernes 21 de agosto inclusive) ✨\n\nEntrás con tu correo y podés reproducirla cada vez que necesites 🤍",
    esperado: "pass",
  },
  {
    nombre: "link del grupo por correo (rechazado 11/08, era correcta)",
    hoy: "martes 11/08/2026 11:17",
    historial:
      "Cliente: Hola, mi correo es noraegueniamartin@gmail.com\nAsesor: Gracias, queda registrado",
    mensaje: "Hola queria saber si ya edta el grupo d wsap por q no estoy yo",
    respuesta:
      "Hola! El link del grupo de WhatsApp te llega por correo electrónico (el que me pasaste: noraegueniamartin@gmail.com) 📧\n\nTe recomiendo revisar bien en spam, correo no deseado y promociones, porque a veces el correo cae ahí\n\nSi tu pago ya quedó confirmado, el link del grupo lo vas a encontrar en ese correo 🥰",
    esperado: "pass",
  },
  {
    nombre: '"hasta mañana viernes 21" un 13/08 (rechazado bien: es falso)',
    hoy: "jueves 13/08/2026 10:24",
    historial:
      "Cliente: Desde el celu veo todo pero desde la compu me sale placa\nAsesor: Puede ser el navegador",
    mensaje:
      "Buen día! Consulta hasta mañana inclusive se puede ver Higiene facial? Xq no terminé de verlo",
    respuesta:
      "Hola! Sí, la grabación está disponible hasta mañana viernes 21 de agosto inclusive 🙌",
    esperado: "fail",
  },
];

function buildParams(c: Caso): MessageCreateParamsNonStreaming {
  const variable = [
    "Validá la siguiente respuesta del asesor ANTES de que llegue al cliente.",
    "",
    "=== Fecha de hoy ===",
    `Hoy es ${c.hoy} (hora de Argentina). Usala para juzgar si un plazo de la base de conocimiento ya venció o sigue vigente.`,
    "",
    "=== Conversación previa (contexto: lo que ya se dijo ANTES de este turno) ===",
    c.historial,
    "",
    "=== Mensaje del cliente (el que se está respondiendo ahora) ===",
    c.mensaje,
    "",
    "=== Respuesta propuesta por el asesor ===",
    c.respuesta,
    "",
    "Devolvé tu veredicto invocando la tool `evaluation_result`.",
  ].join("\n");

  return {
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    system: [{ type: "text", text: evaluatorPrompt }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `=== BASE DE CONOCIMIENTO ===\n${kb}` },
          { type: "text", text: variable },
        ],
      },
    ],
    tools: [
      {
        name: "evaluation_result",
        description: "Reporta el veredicto.",
        input_schema: {
          type: "object",
          properties: {
            pass: { type: "boolean" },
            failedCriteria: { type: "array", items: { type: "string" } },
            suggestion: { type: "string" },
          },
          required: ["pass", "failedCriteria", "suggestion"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "evaluation_result" },
  };
}

async function main() {
  console.log(`Evaluator replay · modelo ${MODEL}\n`);
  let ok = 0;
  for (const c of CASOS) {
    // Pasa por toOpenAIBody a propósito: así el replay también verifica que el
    // breakpoint de cache sobreviva la traducción (la KB tiene que dar hit a
    // partir del segundo caso, aunque el resto del prompt cambie).
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(toOpenAIBody(buildParams(c), MODEL)),
    });
    const json = (await res.json()) as OpenAIResponse & { error?: unknown };
    if (!res.ok) {
      console.error(`  ${c.nombre}: HTTP ${res.status}`, JSON.stringify(json.error));
      continue;
    }
    const { content, usage } = fromOpenAIResponse(json);
    const block = content.find((b) => b.type === "tool_use");
    const veredicto = (block?.input ?? {}) as { pass?: boolean; suggestion?: string };
    const real = veredicto.pass ? "pass" : "fail";
    const match = real === c.esperado;
    if (match) ok++;
    console.log(`${match ? "ok  " : "FALLA"} ${c.nombre}`);
    console.log(`      veredicto: ${real} (esperado ${c.esperado})`);
    if (!veredicto.pass) console.log(`      motivo: ${(veredicto.suggestion ?? "").slice(0, 220)}`);
    console.log(
      `      tokens: cache read ${usage.cache_read_input_tokens} · write ${usage.cache_creation_input_tokens} · fresco ${usage.input_tokens}`,
    );
  }
  console.log(`\n${ok}/${CASOS.length} como se esperaba`);
}

void main();
