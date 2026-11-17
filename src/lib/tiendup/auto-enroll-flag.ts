// ===========================================================================
// Resolución del flag "Alta automática en Tiendup" (lógica pura, sin red).
//
// Prioridad:
//   1. valor en la base (agent_settings.auto_send.tiendup_auto_enroll) si es
//      boolean: lo cambia el equipo desde /payments → Falta acceso;
//   2. si no, la env TIENDUP_AUTO_ENROLL ("false", "0", "off" o "no" apaga;
//      cualquier otro valor no vacío prende);
//   3. si tampoco, prendido.
//
// Separado de auto-enroll-setting.ts (que lee la base) para poder testearlo
// sin Supabase: scripts/test-tiendup-auto-enroll-flag.ts.
// ===========================================================================

export type AutoEnrollSource = "db" | "env" | "default";

export interface AutoEnrollResolution {
  enabled: boolean;
  source: AutoEnrollSource;
}

/** Keys dentro del jsonb agent_settings.auto_send. */
export const AUTO_ENROLL_KEY = "tiendup_auto_enroll";
export const AUTO_ENROLL_UPDATED_BY_KEY = "tiendup_auto_enroll_updated_by";
export const AUTO_ENROLL_UPDATED_AT_KEY = "tiendup_auto_enroll_updated_at";

const OFF_VALUES = ["false", "0", "off", "no"];

/** Valor de la env, o null si no está definida (o vacía). */
export function parseAutoEnrollEnv(raw: string | undefined | null): boolean | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return !OFF_VALUES.includes(v);
}

function asObject(json: unknown): Record<string, unknown> | null {
  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : null;
}

/** El boolean guardado en auto_send, o null si no hay (o no es boolean). */
export function autoEnrollFromAutoSend(autoSend: unknown): boolean | null {
  const v = asObject(autoSend)?.[AUTO_ENROLL_KEY];
  return typeof v === "boolean" ? v : null;
}

/** Quién y cuándo cambió el flag (guardado junto al valor en auto_send). */
export function autoEnrollMetaFromAutoSend(autoSend: unknown): {
  updatedBy: string | null;
  updatedAt: string | null;
} {
  const o = asObject(autoSend);
  const by = o?.[AUTO_ENROLL_UPDATED_BY_KEY];
  const at = o?.[AUTO_ENROLL_UPDATED_AT_KEY];
  return {
    updatedBy: typeof by === "string" ? by : null,
    updatedAt: typeof at === "string" ? at : null,
  };
}

/**
 * auto_send nuevo con el flag seteado, conservando el resto de las keys (la
 * fila es compartida con otros settings del agente: nunca pisarlas).
 */
export function mergeAutoEnroll(
  autoSend: unknown,
  enabled: boolean,
  meta: { updatedBy: string; updatedAt: string },
): Record<string, unknown> {
  return {
    ...(asObject(autoSend) ?? {}),
    [AUTO_ENROLL_KEY]: enabled,
    [AUTO_ENROLL_UPDATED_BY_KEY]: meta.updatedBy,
    [AUTO_ENROLL_UPDATED_AT_KEY]: meta.updatedAt,
  };
}

export function resolveAutoEnroll(input: {
  dbValue: boolean | null;
  envRaw: string | undefined | null;
}): AutoEnrollResolution {
  if (input.dbValue !== null) return { enabled: input.dbValue, source: "db" };
  const env = parseAutoEnrollEnv(input.envRaw);
  if (env !== null) return { enabled: env, source: "env" };
  return { enabled: true, source: "default" };
}
