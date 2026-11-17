-- Settings por tenant del agente (public.agent_settings).
--
-- OJO: esta tabla YA EXISTE en el Supabase compartido (la creó otro panel
-- sobre el mismo proyecto) y no estaba versionada en este repo. Esta migración
-- solo la documenta tal cual está para que el esquema del repo sea
-- reproducible: en prod es un no-op y NO hace falta correrla para que funcione
-- el interruptor "Alta automática en Tiendup" del panel.
--
-- Uso en este panel: el jsonb auto_send guarda, bajo la key
-- "tiendup_auto_enroll" (boolean), si el alta automática en Tiendup está
-- prendida para el tenant, más "tiendup_auto_enroll_updated_by" /
-- "tiendup_auto_enroll_updated_at" (quién y cuándo cambió ese flag puntual).
-- La fila del tenant se crea con upsert desde el panel (cliente con JWT, RLS).
--
-- Idempotente: no agrega columnas ni toca filas de ningún tenant.

create table if not exists public.agent_settings (
  client_slug text primary key default current_client_slug(),
  models jsonb default '{}'::jsonb,
  auto_send jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.agent_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_settings'
      and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on public.agent_settings
      for all
      using (client_slug = current_client_slug())
      with check (client_slug = current_client_slug());
  end if;
end
$$;
