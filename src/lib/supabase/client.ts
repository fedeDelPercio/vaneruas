"use client";

import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import { redirectToLogin } from "@/lib/auth/browser";
import type { Database } from "./types";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;
let cached: { token: string; exp: number } | null = null;
let pending: Promise<string> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const REFRESH_MARGIN_S = 5 * 60;

// También actualiza el socket si la pestaña sigue abierta sin hacer consultas.
function scheduleRefresh(delayMs: number) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      await getAccessToken();
      scheduleTokenRefresh();
    } catch {
      scheduleRefresh(30_000);
    }
  }, delayMs);
}

function scheduleTokenRefresh() {
  if (!cached) return;
  const remaining = cached.exp - Date.now() / 1000;
  // Un token heredado puede vencer en más de lo que admite setTimeout.
  scheduleRefresh(Math.min(2_147_483_647, Math.max(30_000, (remaining - REFRESH_MARGIN_S) * 1000)));
}

async function requestToken(): Promise<string> {
  const response = await fetch("/api/auth/supabase-token", { cache: "no-store" });
  if (!response.ok) {
    if (response.status === 401) redirectToLogin();
    throw new Error("No se pudo obtener el token de Supabase");
  }
  cached = (await response.json()) as { token: string; exp: number };
  scheduleTokenRefresh();
  // Actualiza también los canales existentes si una consulta HTTP renovó el JWT.
  await browserClient?.realtime.setAuth(cached.token);
  return cached.token;
}

async function getAccessToken(): Promise<string> {
  if (cached && cached.exp - Date.now() / 1000 > REFRESH_MARGIN_S) return cached.token;
  pending ??= requestToken().finally(() => { pending = null; });
  return pending;
}

export function getSupabaseBrowserClient() {
  browserClient ??= createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { accessToken: getAccessToken },
  );
  return browserClient;
}


// El SDK puede enviar el primer join antes de resolver el callback asíncrono.
// El dashboard espera al JWT antes de montar los componentes que se suscriben.
export async function prepareSupabaseBrowserClient(): Promise<void> {
  getSupabaseBrowserClient();
  await getAccessToken();
}
