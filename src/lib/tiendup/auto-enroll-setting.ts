import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import {
  autoEnrollFromAutoSend,
  autoEnrollMetaFromAutoSend,
  mergeAutoEnroll,
  resolveAutoEnroll,
  type AutoEnrollResolution,
} from "./auto-enroll-flag";

// ===========================================================================
// Lectura / escritura del interruptor "Alta automática en Tiendup".
//
// Vive en public.agent_settings (una fila por tenant, ver migración 033), en
// el jsonb auto_send. Siempre con el cliente con JWT del tenant
// (getSupabaseServerClient): RLS aísla la fila y el default
// current_client_slug() la crea para este tenant. Nunca service role.
//
// Sin cache: el alta automática lo lee en cada ejecución, así un cambio en el
// panel aplica al instante.
// ===========================================================================

export interface AutoEnrollSetting extends AutoEnrollResolution {
  /** Quién / cuándo cambió este flag puntual (null si nunca se tocó). */
  updatedById: string | null;
  updatedAt: string | null;
  /** La tabla agent_settings no existe (falta aplicar la migración 033). */
  tableMissing: boolean;
}

export class AutoEnrollTableMissingError extends Error {
  constructor() {
    super("Falta aplicar la migración 033 (tabla agent_settings)");
  }
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    (/agent_settings/.test(err.message ?? "") &&
      /does not exist|could not find/i.test(err.message ?? ""))
  );
}

let warned = false;
function warnOnce(reason: string) {
  if (warned) return;
  warned = true;
  // Sin datos sensibles: solo el código / tipo de error.
  console.warn(`[tiendup] no se pudo leer agent_settings (${reason}); se usa la env/default`);
}

/** Estado del flag para este tenant (base > env > prendido). Nunca lanza. */
export async function getTiendupAutoEnrollSetting(): Promise<AutoEnrollSetting> {
  const envRaw = process.env.TIENDUP_AUTO_ENROLL;
  try {
    const { data, error } = await getSupabaseServerClient()
      .from("agent_settings")
      .select("auto_send")
      .maybeSingle();
    if (error) {
      warnOnce(error.code ?? "error");
      return {
        ...resolveAutoEnroll({ dbValue: null, envRaw }),
        updatedById: null,
        updatedAt: null,
        tableMissing: isMissingTable(error),
      };
    }
    const autoSend = data?.auto_send ?? null;
    const dbValue = autoEnrollFromAutoSend(autoSend);
    const meta = dbValue === null ? { updatedBy: null, updatedAt: null } : autoEnrollMetaFromAutoSend(autoSend);
    return {
      ...resolveAutoEnroll({ dbValue, envRaw }),
      updatedById: meta.updatedBy,
      updatedAt: meta.updatedAt,
      tableMissing: false,
    };
  } catch (err) {
    warnOnce(err instanceof Error ? err.name : "excepción");
    return {
      ...resolveAutoEnroll({ dbValue: null, envRaw }),
      updatedById: null,
      updatedAt: null,
      tableMissing: false,
    };
  }
}

/**
 * Guarda el flag en la fila del tenant (upsert). Lee auto_send y mergea para
 * no pisar las otras keys de la fila. Lanza AutoEnrollTableMissingError si la
 * tabla no existe, o Error con el mensaje de la base si falla otra cosa.
 */
export async function setTiendupAutoEnroll(enabled: boolean, profileId: string): Promise<void> {
  const sb = getSupabaseServerClient();
  const { data, error: readErr } = await sb
    .from("agent_settings")
    .select("auto_send")
    .maybeSingle();
  if (readErr) {
    if (isMissingTable(readErr)) throw new AutoEnrollTableMissingError();
    throw new Error(readErr.message);
  }
  const now = new Date().toISOString();
  const autoSend = mergeAutoEnroll(data?.auto_send ?? null, enabled, {
    updatedBy: profileId,
    updatedAt: now,
  });
  // client_slug no se manda: lo pone el default current_client_slug() (JWT),
  // y la policy tenant_isolation rechaza cualquier otro tenant.
  const { error } = await sb
    .from("agent_settings")
    .upsert(
      { auto_send: autoSend as Json, updated_at: now, updated_by: profileId },
      { onConflict: "client_slug" },
    );
  if (error) {
    if (isMissingTable(error)) throw new AutoEnrollTableMissingError();
    throw new Error(error.message);
  }
}
