import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv, serverEnv } from "@/lib/env";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

// ===========================================================================
// Tickets en AI ScaleMap desde el panel.
//
// El botón de feedback del header manda lo que escribió (o grabó) la persona,
// con sus capturas, al portal de AI ScaleMap (POST /api/intake/tickets), que lo
// crea como ticket del proyecto de Vanesa Rúas: "mejora" o "bug". Mismo
// mecanismo que el panel de STAG.
//
// La clave vive en integration_tokens (provider 'aiscalemap', una fila por
// client_slug), una tabla de la base compartida sin policy para el JWT del
// panel: se lee con el cliente admin. AI ScaleMap solo guarda su hash.
// ===========================================================================

const PROVIDER = "aiscalemap";
const TIMEOUT_MS = 30_000;

export type TicketKind = "mejora" | "bug";

export class TicketIntakeError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function createAiScaleMapTicket(input: {
  kind: TicketKind;
  title: string;
  body: string;
  reporter: string;
  page: string | null;
  images: File[];
}): Promise<{ number: number }> {
  // integration_tokens no está en los tipos generados de este repo (la creó la
  // migración de STAG en la base compartida): consulta sin tipar.
  const admin = getSupabaseAdminClient() as unknown as SupabaseClient;
  const { data: row, error } = await admin
    .from("integration_tokens")
    .select("access_token")
    .eq("client_slug", clientEnv.NEXT_PUBLIC_CLIENT_SLUG)
    .eq("provider", PROVIDER)
    .maybeSingle<{ access_token: string | null }>();
  if (error) throw new TicketIntakeError(error.message, 500);
  if (!row?.access_token) {
    throw new TicketIntakeError("Falta configurar la conexión con AI ScaleMap", 503);
  }

  // AI ScaleMap llama "feedback" a una mejora y "ticket" a algo que no anda.
  const form = new FormData();
  form.set("kind", input.kind === "mejora" ? "feedback" : "ticket");
  form.set("title", input.title);
  form.set("body", input.body);
  form.set("reporter", input.reporter);
  if (input.page) form.set("page", input.page);
  for (const img of input.images) form.append("images", img, img.name || "captura");

  const res = await fetch(`${serverEnv().AISCALEMAP_URL}/api/intake/tickets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${row.access_token}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown) => {
    console.error("[aiscalemap] no respondió:", err);
    throw new TicketIntakeError("AI ScaleMap no respondió. Probá de nuevo en un rato", 502);
  });

  const json = (await res.json().catch(() => ({}))) as { number?: number; error?: string };
  if (!res.ok || typeof json.number !== "number") {
    console.error(`[aiscalemap] ${res.status}: ${json.error ?? "sin detalle"}`);
    // Los 400 traen un motivo pensado para la persona (capturas de más, muy pesadas).
    const motivo = res.status === 400 && json.error ? `: ${json.error}` : "";
    throw new TicketIntakeError(`No se pudo crear el ticket en AI ScaleMap${motivo}`, 502);
  }
  return { number: json.number };
}
