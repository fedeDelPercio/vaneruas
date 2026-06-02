import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv, serverEnv } from "@/lib/env";
import type { Database } from "./types";

// ===========================================================================
// Cliente de Supabase para el servidor (API routes, worker, hooks).
//
// El anon key del proyecto va como "apikey" (lo exige el gateway de Supabase).
// El JWT custom con claim client_slug va como "Authorization: Bearer" —
// PostgREST lo lee y lo expone via auth.jwt() para las policies de RLS.
//
// Asi el aislamiento por cliente se enforce a nivel DB sin tocar cada query.
// ===========================================================================
let scopedClient: SupabaseClient<Database> | null = null;
let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseServerClient(): SupabaseClient<Database> {
  if (scopedClient) return scopedClient;
  scopedClient = createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${clientEnv.NEXT_PUBLIC_SUPABASE_CLIENT_JWT}`,
        },
      },
    },
  );
  return scopedClient;
}

/**
 * Cliente admin (service_role). Bypassa RLS — solo usar para tareas que
 * genuinamente necesitan ver/escribir a traves de clientes (migraciones,
 * scripts de mantenimiento). NO usar desde rutas API ni desde el worker
 * en flujos normales.
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient;
  adminClient = createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return adminClient;
}
