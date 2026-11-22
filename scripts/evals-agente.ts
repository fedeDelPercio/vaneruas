// Evals del agente contra el prompt REAL de producción (orquestador + base de
// conocimiento + ficha del evento en vivo desde la tabla `events`) y con las
// mismas tools, así se ve cuándo deriva de verdad.
//
// Los casos salen de lo que más consultaron en el último mes según
// agent_notifications, escritos como escribe la gente (sin tildes, corridos).
//
//   NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2) \
//   SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2) \
//   OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/evals-agente.ts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  toOpenAIBody,
  fromOpenAIResponse,
  type OpenAIResponse,
} from "../src/lib/agent/llm-translate";
// Import directo al archivo del schema: el barrel `tools/index.ts` trae
// `server-only` y no se puede importar desde un script.
import { NOTIFY_TEAM_TOOL_SCHEMA } from "../src/lib/agent/tools/notify_team";
import { sanitizeStyle } from "../src/lib/agent/sanitize";
import { emailContextLine, incompleteEmailContextLine } from "../src/lib/payments/email-ask";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const KEY = process.env.OPENROUTER_API_KEY!;
const MODEL = process.env.OPENROUTER_MODEL_PRIMARY ?? "anthropic/claude-sonnet-4.5";
const AHORA = "viernes 11/09/2026 19:00";

const orq = readFileSync("src/lib/agent/prompts/orchestrator.md", "utf8");
const kb = readFileSync("src/lib/agent/prompts/knowledge-base.md", "utf8");

interface Caso {
  n: string;
  m: string;
  espera: string;
  /** Mensajes previos de la conversación (opcional). */
  historia?: { role: "user" | "assistant"; content: string }[];
  /** Bloque "Pagos de esta conversación" que arma run.ts (opcional). */
  pagos?: string;
  /** Aserciones opcionales (se imprimen como ok / FALLA, no cortan la corrida). */
  check?: {
    /** Categoría de notify_team esperada, o false si NO tiene que derivar. */
    deriva?: string | false;
    /** El texto tiene que matchear todas. */
    debe?: RegExp[];
    /** El texto no tiene que matchear ninguna. */
    noDebe?: RegExp[];
  };
}

// Regla de dos correos: no ofrecer cambio ni consultar al equipo a cuál le llega.
const OFRECE_CAMBIO = /(cambi|modific|actualiz|correg)\w*\s+(el|tu|de)?\s*(correo|mail)/i;
const CONSULTA_EQUIPO = /(pregunt|consult|confirm|chequ|verific)\w*\s+(\w+\s+){0,3}(al|con el)\s+equipo|a\s+cu[aá]l\s+de\s+los\s+dos/i;
const AL_DE_LA_WEB = /(web|p[aá]gina)/i;

// Pedir de nuevo el correo.
const PIDE_CORREO = /(pas[aá]s|mand[aá]s|compart\w*|dej[aá]s|envi[aá]s|necesit\w*|indic[aá]s|confirm[aá]s)\s+(\w+\s+){0,4}(correo|mail)/i;

const CASOS: Caso[] = [
  { n: "Precio", m: "Hola! Cuanto sale la masterclass de peelings de verano?", espera: "$110.000 transferencia / $150.000 en 3 cuotas / USD 90 PayPal" },
  { n: "Fecha y horario", m: "Que dia y a que hora es la masterclass de peelings?", espera: "Sabado 28/11 de 16 a 21 hs" },
  { n: "Quiere anotarse", m: "Me quiero anotar a peelings de verano, como hago?", espera: "Comparte la landing" },
  { n: "Queda grabada?", m: "Si no puedo entrar en vivo queda grabada? Cuanto tiempo la puedo ver?", espera: "Si, Zoom en vivo, grabacion 20 dias" },
  { n: "Hasta cuando me puedo anotar", m: "Hasta cuando hay tiempo de inscribirse?", espera: "Miercoles 25/11 21 hs" },
  { n: "Manda comprobante", m: "Hola! Envio comprobante de la masterclass de peelings de verano. Sofia Lioni, chopimetica@gmail.com", espera: "Lo recibe normal" },
  { n: "Hasta cuando el precio promo (no confirmado)", m: "Los $110.000 hasta cuando rigen? Despues sube?", espera: "Deriva, no lo sabemos" },
  { n: "Grupo de WhatsApp (no confirmado)", m: "Hay grupo de whatsapp para la masterclass?", espera: "Deriva, no lo sabemos" },
  { n: "Control: grabacion masterclass vieja", m: "Puedo ver todavia la grabacion de higiene facial?", espera: "Vencio el 21/08" },
  {
    n: "Dos correos: a cual me llega",
    m: "hola tengo dos correos, a cual me llega el link del grupo?",
    espera: "Le llega al correo que cargo en la web, que lo busque ahi (spam). Sin ofrecer cambio, sin derivar",
    check: { deriva: false, debe: [AL_DE_LA_WEB], noDebe: [OFRECE_CAMBIO, CONSULTA_EQUIPO] },
  },
  {
    n: "Dos correos: se inscribio con otro",
    m: "me inscribi con otro mail, este es el que uso mas: lucia.prueba@gmail.com",
    espera: "Le llega al correo de la web, que lo busque ahi. Sin ofrecer cambio, sin derivar, sin prometer el nuevo",
    check: { deriva: false, debe: [AL_DE_LA_WEB], noDebe: [OFRECE_CAMBIO, CONSULTA_EQUIPO] },
  },
  {
    n: "Dos correos: pide cambiarlo",
    m: "quiero cambiar el correo del acceso a lucia.prueba@gmail.com",
    espera: "Deriva escalado_manual (Pide cambiar el correo de acceso: lucia.prueba@gmail.com)",
    check: { deriva: "escalado_manual" },
  },
  {
    n: "Correo junto al comprobante, despues pregunta que mas necesitan",
    historia: [
      {
        role: "user",
        content: "[Imagen: comprobante de transferencia] Hola! te mando el comprobante de peelings de verano. Sofia Lioni sofi.prueba@gmail.com",
      },
      { role: "assistant", content: "Hola Sofi! Gracias, ya lo recibimos 🙌 El equipo lo valida y te confirmamos por acá" },
    ],
    m: "dale gracias! que mas necesitan de mi?",
    pagos: emailContextLine("ya_tenemos"),
    espera: "No necesita nada mas: el equipo valida el pago y el acceso le llega al correo. NO le pide el correo de nuevo",
    check: { deriva: false, noDebe: [PIDE_CORREO] },
  },
  {
    n: "Correo con espacios, pago verificado",
    historia: [
      { role: "user", content: "hola, mi correo para el acceso es lucia.prueba @ gmail . com" },
      { role: "assistant", content: "Buenísimo Lucía, queda registrado para enviarte el acceso 🙌" },
    ],
    m: "ya me aprobaron el pago? que sigue ahora?",
    // Peor caso: el código no reconoció el correo y la línea dice "SÍ"; la
    // regla del prompt tiene que frenar el pedido igual.
    pagos: emailContextLine("pedir"),
    espera: "No vuelve a pedir el correo (ya lo dio con espacios). Le dice que el acceso le llega al correo",
    check: { deriva: false, noDebe: [PIDE_CORREO] },
  },
  {
    n: "Comprobante en revision sin correo: lo pide una vez",
    historia: [
      { role: "user", content: "[Imagen: comprobante de transferencia]" },
      { role: "assistant", content: "Genial, gracias por compartir el comprobante 🙌 El equipo lo revisa y te confirma la inscripción a la brevedad" },
    ],
    m: "cuanto tarda en confirmarse?",
    pagos: emailContextLine("pedir_en_revision"),
    espera: "Responde y en el mismo mensaje pide el correo de la web. No dice que el pago esta aprobado",
    check: { deriva: false, debe: [PIDE_CORREO, AL_DE_LA_WEB], noDebe: [/(pago|comprobante)\s+(ya\s+)?(qued[oó]\s+)?(aprobado|verificado)/i] },
  },
  {
    n: "Correo incompleto: pide reenviarlo completo",
    m: "abcdef1234@gmail.",
    pagos: incompleteEmailContextLine("a***@gmail."),
    espera: "Le pide que lo reenvie completo, no lo da por registrado",
    check: { deriva: false, debe: [/complet/i], noDebe: [/queda\s+registrado/i] },
  },
  {
    n: "Correo ya escrito con comprobante en revision: no lo pide",
    historia: [
      { role: "user", content: "[Imagen: comprobante de transferencia] Ana Prueba ana.prueba@gmail.com" },
      { role: "assistant", content: "Genial, gracias por compartir el comprobante 🙌 El equipo lo revisa y te confirma la inscripción a la brevedad" },
    ],
    m: "necesitan algo mas?",
    pagos: emailContextLine("ya_tenemos"),
    espera: "No necesita nada mas, no vuelve a pedir el correo",
    check: { deriva: false, noDebe: [PIDE_CORREO] },
  },
];

/** Aplica las aserciones de un caso. Devuelve los motivos de falla. */
function chequear(c: Caso, texto: string, cat: string | null): string[] {
  const fallas: string[] = [];
  const ck = c.check;
  if (!ck) return fallas;
  if (ck.deriva === false && cat) fallas.push(`derivó (${cat}) y no tenía que derivar`);
  if (typeof ck.deriva === "string" && cat !== ck.deriva) fallas.push(`esperaba derivar con ${ck.deriva}, dio ${cat ?? "sin derivar"}`);
  for (const re of ck.debe ?? []) if (!re.test(texto)) fallas.push(`no matchea ${re}`);
  for (const re of ck.noDebe ?? []) if (re.test(texto)) fallas.push(`matchea ${re}`);
  return fallas;
}

async function eventsBlock(): Promise<string> {
  const { data } = await sb
    .from("events")
    .select("title, kind, event_at, event_end_at, details, landing_url")
    .eq("client_slug", "vanesaruas")
    .eq("status", "activo");
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date(iso));
  const bloques = (data ?? []).map((e) =>
    [
      `## ${e.title} (${e.kind === "congress" ? "Congreso" : "Masterclass"})`,
      e.event_at
        ? `- **Fecha del evento:** ${e.event_end_at ? `del ${fecha(e.event_at)} al ${fecha(e.event_end_at)}` : fecha(e.event_at)}`
        : "",
      e.landing_url ? `- **Link de la web:** ${e.landing_url} (podés compartirlo si quiere ver más detalle)` : "",
      "",
      (e.details ?? "").trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "# EVENTOS VIGENTES",
    "",
    "Estos son los eventos que podés comunicar ahora mismo, con sus precios y fechas actualizadas. Tienen prioridad sobre cualquier dato de evento más abajo en la base de conocimiento. Si un evento no figura acá, no lo ofrezcas todavía.",
    "",
    bloques.join("\n\n"),
  ].join("\n");
}

async function main() {
  const eventos = await eventsBlock();
  console.log(`# Evals del agente\n\nModelo ${MODEL} · ahora simulado: ${AHORA}\n`);
  let fallasTotales = 0;

  for (const c of CASOS) {
    const params: MessageCreateParamsNonStreaming = {
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: `${orq}\n\n# BASE DE CONOCIMIENTO\n\n${kb}\n\n${eventos}`,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text:
            `=== Contexto de horario ===\nAhora es ${AHORA} (hora de Argentina).\n\n=== Estado del contacto ===\nEsta persona YA ES CLIENTA (ya pagó o acreditó su título).` +
            (c.pagos ? `\n\n=== Pagos de esta conversación ===\n${c.pagos}` : ""),
        },
      ],
      messages: [...(c.historia ?? []), { role: "user", content: c.m }],
      tools: [NOTIFY_TEAM_TOOL_SCHEMA],
    };
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(toOpenAIBody(params, MODEL)),
    });
    const j = (await r.json()) as OpenAIResponse & { error?: unknown };
    if (!r.ok) {
      console.error(`## ${c.n}\n\nHTTP ${r.status} ${JSON.stringify(j.error).slice(0, 200)}\n`);
      continue;
    }
    const res = fromOpenAIResponse(j);
    // sanitizeStyle es lo que corre en produccion antes de enviar (saca el
    // **bold**, el punto final y demas), asi el eval muestra el texto real.
    const texto = sanitizeStyle(
      res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim(),
    );
    const notify = res.content.find((b) => b.type === "tool_use" && b.name === "notify_team");
    const cat = notify ? (notify.input as { category?: string })?.category : null;

    console.log(`## ${c.n}`);
    console.log(`\n**Clienta:** ${c.m}\n`);
    console.log(`**Valentina:**\n`);
    for (const parte of texto.split(/\n\s*---\s*\n/)) console.log(`> ${parte.replace(/\n/g, "\n> ")}\n`);
    console.log(`**Deriva:** ${notify ? `sí (${cat})` : "no"}`);
    console.log(`**Esperado:** ${c.espera}\n`);
    if (c.check) {
      const fallas = chequear(c, texto, cat ?? null);
      if (fallas.length) fallasTotales++;
      console.log(fallas.length ? `**Chequeo:** FALLA · ${fallas.join(" · ")}\n` : "**Chequeo:** ok\n");
    }
  }
  console.log(fallasTotales ? `\n${fallasTotales} caso(s) con FALLA en el chequeo` : "\nChequeos ok");
}

void main();
