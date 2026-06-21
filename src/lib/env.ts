import { z } from "zod";

// ===========================================================================
// Validacion de variables de entorno con zod.
//
// Se separan en dos grupos:
//  - clientEnv: variables NEXT_PUBLIC_*, disponibles en browser y server.
//    Se validan al importar este modulo (es seguro en cualquier contexto).
//  - serverEnv(): variables server-only (secrets). Se validan de forma
//    perezosa la primera vez que se las usa, para no romper el bundle del
//    cliente (donde estos valores no existen).
//
// Si falta algo critico, la validacion lanza un error claro y la app no
// arranca a medias ("fail loud").
// ===========================================================================

// --- Variables publicas ----------------------------------------------------
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL invalida"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY es obligatoria"),
  // JWT firmado con el JWT secret del proyecto, con claim client_slug. Se
  // envia como Authorization: Bearer para que PostgREST lo lea via
  // auth.jwt() en las policies de RLS. NO reemplaza al anon key — ese sigue
  // siendo el "apikey" que el gateway de Supabase exige.
  NEXT_PUBLIC_SUPABASE_CLIENT_JWT: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_CLIENT_JWT es obligatoria"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url("NEXT_PUBLIC_APP_URL invalida")
    .default("http://localhost:3000"),
  // Slug del cliente activo. Lo usan algunos filtros del frontend (ej:
  // subscripciones Realtime). El aislamiento real de datos lo hace RLS via
  // el claim client_slug del CLIENT_JWT (ver migration 004).
  NEXT_PUBLIC_CLIENT_SLUG: z
    .string()
    .min(1, "NEXT_PUBLIC_CLIENT_SLUG es obligatoria (ej: 'ibath', 'quintaglia')")
    .regex(/^[a-z][a-z0-9_]*$/, "NEXT_PUBLIC_CLIENT_SLUG debe ser snake_case"),
  // locationId de la subcuenta de GoHighLevel. Lo usa el panel para armar el
  // link directo a la conversación en GHL ("Ver conversación" en Aprobaciones,
  // Derivaciones y Certificados). Opcional: si falta, esos botones caen al
  // visor interno del panel.
  NEXT_PUBLIC_GHL_LOCATION_ID: z.string().min(1).optional(),
});

function parseClientEnv() {
  // En Next.js las NEXT_PUBLIC_* se inyectan estaticamente: hay que
  // referenciarlas por nombre completo, no por indice dinamico.
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_CLIENT_JWT: process.env.NEXT_PUBLIC_SUPABASE_CLIENT_JWT,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CLIENT_SLUG: process.env.NEXT_PUBLIC_CLIENT_SLUG,
    NEXT_PUBLIC_GHL_LOCATION_ID: process.env.NEXT_PUBLIC_GHL_LOCATION_ID,
  });
  if (!parsed.success) {
    throw new Error(
      "Variables de entorno publicas invalidas o ausentes:\n" +
        parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  return parsed.data;
}

export const clientEnv = parseClientEnv();

// --- Variables server-only -------------------------------------------------
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY es obligatoria"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY es obligatoria"),
  ANTHROPIC_MODEL_ORCHESTRATOR: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_MODEL_SUBAGENT: z.string().default("claude-haiku-4-5"),
  ANTHROPIC_MODEL_EVALUATOR: z.string().default("claude-haiku-4-5"),
  // Modelo para OCR de comprobantes (Claude vision). Sonnet tiene buena
  // lectura de documentos; se puede sobre-escribir por env si hace falta.
  ANTHROPIC_MODEL_VISION: z.string().default("claude-sonnet-4-6"),
  AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(3),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  CRON_SECRET: z.string().min(1, "CRON_SECRET es obligatoria"),
  WEBHOOK_SIGNING_SECRET: z
    .string()
    .min(1, "WEBHOOK_SIGNING_SECRET es obligatoria"),
  // Secreto compartido con el webhook entrante de GHL (header x-ghl-secret).
  // Opcional: si no está seteado, el endpoint no exige el header (en prod el
  // dominio ya está detrás del bypass de Deployment Protection). Setearlo en
  // prod suma una segunda capa de auth.
  GHL_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Private Integration Token de GHL (scope conversations/message.write) para
  // enviar las respuestas del agente a WhatsApp. Opcional: si falta, el envío
  // saliente queda deshabilitado (la respuesta igual queda en el panel).
  GHL_API_KEY: z.string().min(1).optional(),
  // Allowlist de contact_id de GHL a los que el agente PUEDE responder por
  // WhatsApp (fail-closed). Vacía/sin setear -> no se manda a nadie. "*" ->
  // todos (producción). "id1,id2" -> solo esos. Guardrail de testing.
  GHL_SEND_ALLOWLIST: z.string().optional(),
  // Transcripción de audios de WhatsApp (OpenAI Whisper). Opcional: si la key
  // no está, los audios caen al placeholder y el agente pide que lo escriban
  // (no se rompe nada). El modelo se puede sobre-escribir por env.
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("gpt-4o-transcribe"),
  // Acumulación de mensajes (debounce) para WhatsApp: ventana de silencio en
  // segundos antes de consolidar y responder los mensajes que llegan seguidos.
  // Testing: 20. Producción: ~60. Solo aplica a conversaciones de WhatsApp.
  MESSAGE_DEBOUNCE_SECONDS: z.coerce.number().int().nonnegative().default(20),
  // Email notifications via Gmail SMTP + App Password. Las tres son
  // opcionales: si alguna falta, el sender hace skip silencioso y la app
  // sigue funcionando (no bloquea el flow del agente).
  GMAIL_USER: z.string().email().optional(),
  GMAIL_APP_PASSWORD: z.string().min(1).optional(),
  EMAIL_NOTIFY_TO: z.string().email().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cachedServerEnv: ServerEnv | null = null;

/**
 * Devuelve las variables server-only validadas. Lanza error si se invoca
 * en el browser o si falta alguna variable critica.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() no puede usarse en el cliente.");
  }
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL_ORCHESTRATOR: process.env.ANTHROPIC_MODEL_ORCHESTRATOR,
    ANTHROPIC_MODEL_SUBAGENT: process.env.ANTHROPIC_MODEL_SUBAGENT,
    ANTHROPIC_MODEL_EVALUATOR: process.env.ANTHROPIC_MODEL_EVALUATOR,
    ANTHROPIC_MODEL_VISION: process.env.ANTHROPIC_MODEL_VISION,
    AGENT_MAX_ITERATIONS: process.env.AGENT_MAX_ITERATIONS,
    AGENT_TIMEOUT_MS: process.env.AGENT_TIMEOUT_MS,
    CRON_SECRET: process.env.CRON_SECRET,
    WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET,
    GHL_WEBHOOK_SECRET: process.env.GHL_WEBHOOK_SECRET,
    GHL_API_KEY: process.env.GHL_API_KEY,
    GHL_SEND_ALLOWLIST: process.env.GHL_SEND_ALLOWLIST,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_TRANSCRIBE_MODEL: process.env.OPENAI_TRANSCRIBE_MODEL,
    MESSAGE_DEBOUNCE_SECONDS: process.env.MESSAGE_DEBOUNCE_SECONDS,
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
    EMAIL_NOTIFY_TO: process.env.EMAIL_NOTIFY_TO,
  });
  if (!parsed.success) {
    throw new Error(
      "Variables de entorno del servidor invalidas o ausentes:\n" +
        parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n") +
        "\nRevisar .env.local (ver .env.example).",
    );
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}
