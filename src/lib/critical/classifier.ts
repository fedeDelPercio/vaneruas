// ===========================================================================
// Clasificador de conversaciones "Crítico" — lógica pura (sin red ni DB).
//
// Decide si una conversación necesita atención urgente del equipo por el tono
// de la contacta: enojo, reclamo de mala manera, insatisfacción explícita,
// amenaza de denuncia o escrache, o un reclamo repetido sin respuesta. Las
// consultas normales, el apuro amable y los comprobantes NO son críticos.
//
// Acá viven las piezas testeables (scripts/test-critical-classifier.ts): armar
// el prompt, parsear la respuesta del modelo, decidir si hay que re-evaluar y
// reconocer el error de "columna inexistente" (migración 034 sin aplicar). La
// llamada al modelo y el guardado están en ./evaluate.ts (server-only).
// ===========================================================================

/** Mensajes que se le pasan al modelo (los últimos de la conversación). */
export const CRITICAL_CONTEXT_MESSAGES = 10;
/** Tope por mensaje: un texto larguísimo no aporta y encarece. */
const MAX_CHARS_PER_MESSAGE = 600;
export const MAX_REASON_CHARS = 120;

export interface ClassifierMessage {
  role: string;
  content: string | null;
  attachment_path?: string | null;
  created_at: string;
}

export interface CriticalVerdict {
  critical: boolean;
  reason: string;
}

export const CRITICAL_SYSTEM_PROMPT = `Sos un clasificador para el equipo de atención de una escuela de formación para profesionales de la estética. Leés el final de una conversación de WhatsApp entre una contacta (la clienta) y el equipo (la asistente IA Valentina o una persona) y decidís si la conversación es CRÍTICA: si el equipo tiene que mirarla ya porque la contacta está mal atendida o enojada.

Es CRÍTICA si la contacta, en sus mensajes:
- muestra enojo o reclama de mala manera (insultos, mayúsculas de enojo, tono agresivo)
- expresa insatisfacción explícita con el servicio, el curso, el pago o la atención
- amenaza con denunciar, hacer un reclamo formal, escrachar o exponer en redes, pedir la devolución de mala manera
- repite el mismo reclamo o pregunta varias veces sin que nadie le responda

NO es crítica:
- una consulta normal (precios, fechas, links, accesos, certificados) aunque sea insistente
- el apuro amable ("cuándo me pasan el acceso?", "porfa avisame")
- el envío de comprobantes, títulos o datos
- un saludo, un agradecimiento o una despedida

Juzgá solo lo que escribió la contacta, usando el resto como contexto. Ante la duda, no es crítica.

Respondé SOLO con un objeto JSON, sin texto alrededor ni bloque de código:
{"critical": true o false, "reason": "motivo corto en español, máximo 120 caracteres, sin datos personales"}`;

const ROLE_LABEL: Record<string, string> = {
  user: "Contacta",
  assistant: "Valentina (IA)",
  human: "Equipo",
};

/** Saca los marcadores de adjuntos ("[Adjunto: url]", "[Adjunto]") del texto. */
function stripAttachments(text: string): string {
  return text
    .replace(/\[Adjunto(?::[^\]]*)?\]/gi, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/**
 * Arma el texto de la conversación para el modelo: los últimos N mensajes con
 * texto (sin carteles de sistema ni adjuntos), en orden cronológico.
 */
export function buildTranscript(
  messages: ClassifierMessage[],
  limit = CRITICAL_CONTEXT_MESSAGES,
): string {
  const lines: string[] = [];
  const sorted = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const m of sorted) {
    const label = ROLE_LABEL[m.role];
    if (!label) continue; // system y cualquier otro rol fuera
    const text = stripAttachments((m.content ?? "").replace(/\n\s*---\s*\n/g, "\n"));
    if (!text) continue; // solo un adjunto
    const clipped = text.length > MAX_CHARS_PER_MESSAGE ? `${text.slice(0, MAX_CHARS_PER_MESSAGE)}…` : text;
    lines.push(`${label}: ${clipped}`);
  }
  return lines.slice(-limit).join("\n\n");
}

/** Mensaje de usuario que se le manda al modelo. */
export function buildUserPrompt(transcript: string): string {
  return `Conversación (del más viejo al más nuevo):\n\n${transcript}\n\nRespondé solo el JSON.`;
}

/**
 * Parsea la respuesta del modelo. Tolera texto o un bloque de código alrededor
 * del JSON. Devuelve null si no hay un veredicto válido (el caller no toca
 * nada en ese caso).
 */
export function parseCriticalResponse(raw: string | null | undefined): CriticalVerdict | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  let critical: boolean;
  if (typeof obj.critical === "boolean") critical = obj.critical;
  else if (obj.critical === "true" || obj.critical === "false") critical = obj.critical === "true";
  else return null;
  const reasonRaw = typeof obj.reason === "string" ? obj.reason : "";
  let reason = reasonRaw.replace(/\s+/g, " ").trim();
  if (reason.length > MAX_REASON_CHARS) reason = `${reason.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…`;
  if (critical && !reason) reason = "Marcada como crítica por el clasificador";
  return { critical, reason };
}

/**
 * ¿Hay que (re)evaluar? Solo si entró un mensaje de la contacta posterior al
 * último evaluado. Limpiar el tag a mano no cambia `evaluatedAt`: la próxima
 * evaluación llega con el próximo mensaje de la contacta.
 */
export function shouldEvaluate(args: {
  lastInboundAt: string | null;
  evaluatedAt: string | null;
}): boolean {
  if (!args.lastInboundAt) return false;
  if (!args.evaluatedAt) return true;
  return new Date(args.lastInboundAt).getTime() > new Date(args.evaluatedAt).getTime();
}

/**
 * Qué escribir en la conversación después de evaluar. El tag es "pegajoso":
 * el clasificador lo prende pero no lo apaga (que la contacta se calme en el
 * último mensaje no significa que alguien la atendió). Lo apaga el equipo.
 */
export interface CriticalPatch {
  critical?: boolean;
  critical_reason?: string;
  critical_at?: string;
  critical_evaluated_at: string;
}

export function nextCriticalState(
  current: { critical: boolean | null; criticalAt: string | null },
  verdict: CriticalVerdict,
  evaluatedAt: string,
  now: Date = new Date(),
): CriticalPatch {
  if (verdict.critical) {
    return {
      critical: true,
      critical_reason: verdict.reason,
      critical_at: current.critical ? current.criticalAt ?? now.toISOString() : now.toISOString(),
      critical_evaluated_at: evaluatedAt,
    };
  }
  return { critical_evaluated_at: evaluatedAt };
}

/**
 * Error de "columna inexistente": la migración 034 no está aplicada. Postgres
 * devuelve 42703 al leer; PostgREST, PGRST204 al escribir una columna que no
 * está en su cache de esquema.
 */
export function isMissingColumnError(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("critical") && (msg.includes("does not exist") || msg.includes("schema cache"));
}

/** Flag de env: apagado salvo "true", "1", "on" o "yes". */
export function parseEnabledFlag(raw: string | null | undefined): boolean {
  return ["true", "1", "on", "yes", "si", "sí"].includes((raw ?? "").trim().toLowerCase());
}

/**
 * Corre una consulta con columnas opcionales (las de la migración 034). Si la
 * base dice que no existen, la repite sin ellas y avisa con `missing: true`
 * para que el caller lo recuerde y no pague el doble pedido cada vez.
 */
export async function withOptionalColumns<
  T extends { error: { code?: string | null; message?: string | null } | null },
>(
  run: (cols: string) => PromiseLike<T>,
  baseCols: string,
  optionalCols: string,
  tryOptional: boolean,
): Promise<{ res: T; missing: boolean }> {
  if (tryOptional) {
    const res = await run(baseCols + optionalCols);
    if (!res.error || !isMissingColumnError(res.error)) return { res, missing: false };
    return { res: await run(baseCols), missing: true };
  }
  return { res: await run(baseCols), missing: false };
}
