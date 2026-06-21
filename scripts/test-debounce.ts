// Test determinístico de la lógica de acumulación de mensajes (debounce).
// Correr con: npx tsx scripts/test-debounce.ts
import { resolveWhatsAppTurn, type TurnMessage } from "../src/lib/agent/debounce";

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}`, extra ?? "");
  }
}

const DEBOUNCE = 20;
const T0 = 1_000_000_000_000; // base epoch ms arbitraria
const sec = (n: number) => new Date(T0 + n * 1000).toISOString();

function userMsg(id: string, atSec: number, content: string, attach = false): TurnMessage {
  return {
    id,
    role: "user",
    content,
    created_at: sec(atSec),
    attachment_path: attach ? `path/${id}` : null,
  };
}
function asstMsg(id: string, atSec: number): TurnMessage {
  return { id, role: "assistant", content: "ok", created_at: sec(atSec), attachment_path: null };
}

// --- 1. Un solo mensaje, ventana cumplida → answer ---------------------------
{
  const msgs = [userMsg("m1", 0, "hola")];
  const d = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 20_000);
  assert("1 mensaje, 20s después → answer", d.action === "answer", d);
  if (d.action === "answer") {
    assert("1 mensaje → userMessage = 'hola'", d.userMessage === "hola", d.userMessage);
    assert("1 mensaje → anchor = m1", d.anchorMessageId === "m1", d.anchorMessageId);
  }
}

// --- 2. Un solo mensaje, dentro de la ventana → defer ------------------------
{
  const msgs = [userMsg("m1", 0, "hola")];
  const d = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 5_000);
  assert("1 mensaje, 5s después → defer", d.action === "defer", d);
  if (d.action === "defer") {
    assert("defer → process_after = 0+20s", d.processAfter === sec(20), d.processAfter);
  }
}

// --- 3. Burst de 3 mensajes; el último resetea la ventana -------------------
{
  // m1@0, m2@10, m3@15. now=20 → último fue hace 5s → defer hasta 15+20=35.
  const msgs = [userMsg("m1", 0, "hola"), userMsg("m2", 10, "una consulta"), userMsg("m3", 15, "sobre el congreso")];
  const dEarly = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 20_000);
  assert("burst: now=20 (último hace 5s) → defer", dEarly.action === "defer", dEarly);
  if (dEarly.action === "defer") {
    assert("burst defer → hasta 15+20=35s", dEarly.processAfter === sec(35), dEarly.processAfter);
  }

  // now=35 → silencio cumplido → answer consolidado en orden.
  const dLate = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 35_000);
  assert("burst: now=35 → answer", dLate.action === "answer", dLate);
  if (dLate.action === "answer") {
    assert(
      "burst → consolida los 3 en orden",
      dLate.userMessage === "hola\nuna consulta\nsobre el congreso",
      dLate.userMessage,
    );
    assert("burst → anchor = último (m3)", dLate.anchorMessageId === "m3", dLate.anchorMessageId);
    assert("burst → turnMessageIds = [m1,m2,m3]", dLate.turnMessageIds.join(",") === "m1,m2,m3");
  }
}

// --- 4. Turno ya respondido (último mensaje es del asistente) → skip --------
{
  const msgs = [userMsg("m1", 0, "hola"), asstMsg("a1", 21)];
  const d = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 60_000);
  assert("respondido (asst al final) → skip", d.action === "skip", d);
}

// --- 5. Solo el run final cuenta (mensajes viejos ya respondidos) -----------
{
  // m1 respondido por a1; después llegan m2,m3 (run nuevo).
  const msgs = [
    userMsg("m1", 0, "viejo"),
    asstMsg("a1", 5),
    userMsg("m2", 40, "nuevo uno"),
    userMsg("m3", 45, "nuevo dos"),
  ];
  const d = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 65_000);
  assert("run nuevo: now=65 (último@45) → answer", d.action === "answer", d);
  if (d.action === "answer") {
    assert("run nuevo → consolida solo m2,m3", d.userMessage === "nuevo uno\nnuevo dos", d.userMessage);
    assert("run nuevo → no incluye m1", !d.turnMessageIds.includes("m1"), d.turnMessageIds);
  }
}

// --- 6. Adjunto (comprobante) en el run → se excluye del texto --------------
{
  // m1 texto, m2 comprobante (adjunto). El texto consolidado excluye m2.
  const msgs = [userMsg("m1", 0, "ahí va"), userMsg("m2", 5, "", true)];
  const d = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 30_000);
  assert("con adjunto → answer", d.action === "answer", d);
  if (d.action === "answer") {
    assert("con adjunto → texto solo m1", d.userMessage === "ahí va", d.userMessage);
    // El adjunto igual cuenta para 'el turno' (anchor), pero no para el texto.
    assert("con adjunto → turnIds incluye m1 y m2", d.turnMessageIds.join(",") === "m1,m2");
  }
}

// --- 7. Run solo con adjuntos (sin texto) → skip ----------------------------
{
  const msgs = [userMsg("m1", 0, "", true)];
  const d = resolveWhatsAppTurn(msgs, DEBOUNCE, T0 + 30_000);
  assert("solo adjunto, sin texto → skip", d.action === "skip", d);
}

console.log(failures === 0 ? "\nTODOS OK" : `\n${failures} FALLARON`);
process.exit(failures === 0 ? 0 : 1);
