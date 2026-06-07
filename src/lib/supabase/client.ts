"use client";

import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import type { Database } from "./types";

// Cliente de Supabase para el browser.
//
// - anon key del proyecto va como "apikey" (lo exige el gateway).
// - JWT custom con claim client_slug va como Authorization: Bearer.
// - El mismo JWT se entrega al WebSocket de Realtime via `accessToken`
//   callback, que supabase-js consulta antes de cada (re)conexión y antes
//   de cada subscribe. Asi RLS aplica tanto a queries HTTP como a eventos
//   Realtime, sin race condition (el patron viejo `realtime.setAuth(JWT)`
//   post-construccion deja una ventana en la que el primer subscribe puede
//   correr con la auth vieja, y los eventos NO llegan al browser hasta un
//   refresh).
let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const jwt = clientEnv.NEXT_PUBLIC_SUPABASE_CLIENT_JWT;
  browserClient = createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
      accessToken: async () => jwt,
    },
  );
  return browserClient;
}
