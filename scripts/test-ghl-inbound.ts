// Test determinístico de la planificación de adjuntos entrantes.
// Correr con: npx tsx scripts/test-ghl-inbound.ts
import {
  freshAttachmentCaptions,
  planInbound,
} from "../src/lib/providers/ghl-inbound";
import type { GhlInboundMessage } from "../src/lib/providers/ghl";

let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  ok  " + name);
  else {
    fail++;
    console.error("FAIL  " + name, extra ?? "");
  }
}

const T0 = 1_000_000_000_000;
const iso = (sec: number) => new Date(T0 + sec * 1000).toISOString();
function msg(
  body: string,
  attachments: string[],
  atSec: number,
): GhlInboundMessage {
  return { body, attachments, messageType: "TYPE_WHATSAPP", dateAdded: iso(atSec) };
}

// Helper: plan completo desde recent + processed + webhookText.
function plan(recent: GhlInboundMessage[], processed: string[], text: string, nowSec: number) {
  const caps = freshAttachmentCaptions(recent, T0 + nowSec * 1000);
  return planInbound(caps, new Set(processed), text);
}

// --- 1. Comprobante con caption + texto posterior (el bug reportado) ---------
{
  // newest-first como devuelve GHL
  const recent = [
    msg("asi va ok?", [], 9),
    msg("va mi comprobante", ["urlA"], 6),
  ];
  // webhook del comprobante:
  const p1 = plan(recent, [], "va mi comprobante", 12);
  ok("comprobante: 1 adjunto", p1.attachments.length === 1, p1);
  ok("comprobante: url correcta", p1.attachments[0]?.url === "urlA");
  ok("comprobante: caption correcto", p1.attachments[0]?.caption === "va mi comprobante");
  ok("comprobante: sin textItem (es caption)", p1.textItem === null, p1);

  // webhook del texto posterior "asi va ok?" (urlA ya procesada):
  const p2 = plan(recent, ["urlA"], "asi va ok?", 13);
  ok("texto posterior: sin adjuntos nuevos", p2.attachments.length === 0, p2);
  ok("texto posterior: textItem = 'asi va ok?'", p2.textItem === "asi va ok?");
}

// --- 2. Varias imágenes sueltas (sin caption) → todas, oldest-first ----------
{
  const recent = [
    msg("", ["url3"], 8),
    msg("", ["url2"], 7),
    msg("", ["url1"], 6),
  ];
  const p = plan(recent, [], "", 12);
  ok("3 imágenes: 3 adjuntos", p.attachments.length === 3, p);
  ok(
    "3 imágenes: oldest-first url1,url2,url3",
    p.attachments.map((a) => a.url).join(",") === "url1,url2,url3",
    p,
  );
  ok("3 imágenes: sin textItem", p.textItem === null);
}

// --- 3. Dedup: si ya procesamos algunas, solo van las nuevas -----------------
{
  const recent = [msg("", ["url3"], 8), msg("", ["url2"], 7), msg("", ["url1"], 6)];
  const p = plan(recent, ["url1", "url2"], "", 12);
  ok("dedup: solo url3", p.attachments.map((a) => a.url).join(",") === "url3", p);
}

// --- 4. Ventana: adjuntos viejos se ignoran ---------------------------------
{
  const recent = [
    msg("", ["nuevo"], 100),
    msg("", ["viejo"], 0), // 100s después estamos a now=200 → viejo = hace 200s
  ];
  // ventana default 15min: ambos entran. Probamos ventana corta de 150s:
  const caps = freshAttachmentCaptions(recent, T0 + 200 * 1000, 150 * 1000);
  const p = planInbound(caps, new Set(), "");
  ok("ventana: 'viejo' (hace 200s) fuera", !p.attachments.some((a) => a.url === "viejo"), p);
  ok("ventana: 'nuevo' (hace 100s) dentro", p.attachments.some((a) => a.url === "nuevo"), p);
}

// --- 5. Texto puro (sin adjuntos) → solo textItem ----------------------------
{
  const recent = [msg("hola, una consulta", [], 5)];
  const p = plan(recent, [], "hola, una consulta", 12);
  ok("texto puro: sin adjuntos", p.attachments.length === 0);
  ok("texto puro: textItem", p.textItem === "hola, una consulta");
}

// --- 6. Imagen con caption + OTRA imagen suelta (mismo burst) -----------------
{
  const recent = [
    msg("", ["urlB"], 7),
    msg("ahí van los dos", ["urlA"], 6),
  ];
  const p = plan(recent, [], "ahí van los dos", 12);
  ok("2 imágenes: ambas", p.attachments.length === 2, p);
  ok(
    "2 imágenes: urlA con caption, urlB sin",
    p.attachments.find((a) => a.url === "urlA")?.caption === "ahí van los dos" &&
      p.attachments.find((a) => a.url === "urlB")?.caption === "",
    p,
  );
  ok("2 imágenes: textItem null (es caption de urlA)", p.textItem === null, p);
}

console.log(fail === 0 ? "\nTODOS OK" : `\n${fail} FALLARON`);
process.exit(fail === 0 ? 0 : 1);
