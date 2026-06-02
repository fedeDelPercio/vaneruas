"use client";

import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import type { Database } from "./types";

// Cliente de Supabase para el browser.
//
// - anon key del proyecto va como "apikey" (lo exige el gateway).
// - JWT custom con claim client_slug va como Authorization: Bearer y se
//   sincroniza tambien al websocket de Realtime via setAuth, asi RLS aplica
//   tanto a consultas PostgREST como a eventos Realtime.
let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${clientEnv.NEXT_PUBLIC_SUPABASE_CLIENT_JWT}`,
        },
      },
    },
  );
  // Pasamos el JWT custom al canal de Realtime para que los broadcasts
  // pasen el chequeo de RLS (que lee auth.jwt() -> client_slug).
  browserClient.realtime.setAuth(clientEnv.NEXT_PUBLIC_SUPABASE_CLIENT_JWT);
  return browserClient;
}
