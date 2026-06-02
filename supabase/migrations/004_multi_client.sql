-- ===========================================================================
-- Multi-cliente en un solo proyecto Supabase.
--
-- Estrategia: una columna `client_slug` en cada tabla con datos del cliente,
-- y Row Level Security (RLS) que filtra por el slug que viene en el header
-- HTTP `X-Client-Slug` de cada request (lo setea el cliente supabase-js de
-- cada worktree, leyendolo de la env var NEXT_PUBLIC_CLIENT_SLUG).
--
-- Postgres se vuelve el guardia: cualquier query (con o sin WHERE) solo ve
-- filas del cliente activo. Si una query se olvida el filtro, devuelve 0
-- filas. No hay forma de mezclar datos entre clientes ni por bug ni por
-- accidente.
--
-- Backfill: todas las filas existentes se asumen del cliente 'ibath' (es
-- la unica data de prueba que hay hoy en el proyecto compartido).
-- ===========================================================================

-- --- Helper que lee el slug del header de la request --------------------
-- PostgREST expone los headers de la request via current_setting('request.headers').
-- Usamos esta funcion en defaults y policies para no repetir el cast/lookup.
create or replace function current_client_slug() returns text
language sql stable as $$
  select nullif(
    current_setting('request.headers', true)::json ->> 'x-client-slug',
    ''
  );
$$;

-- --- Agregar columna client_slug en las 10 tablas (nullable + backfill) ---
alter table profiles                     add column client_slug text;
alter table conversations                add column client_slug text;
alter table messages                     add column client_slug text;
alter table agent_traces                 add column client_slug text;
alter table agent_trace_steps            add column client_slug text;
alter table agent_jobs                   add column client_slug text;
alter table comments                     add column client_slug text;
alter table outbound_webhooks            add column client_slug text;
alter table outbound_webhook_deliveries  add column client_slug text;
alter table agent_notifications          add column client_slug text;

update profiles                     set client_slug = 'ibath' where client_slug is null;
update conversations                set client_slug = 'ibath' where client_slug is null;
update messages                     set client_slug = 'ibath' where client_slug is null;
update agent_traces                 set client_slug = 'ibath' where client_slug is null;
update agent_trace_steps            set client_slug = 'ibath' where client_slug is null;
update agent_jobs                   set client_slug = 'ibath' where client_slug is null;
update comments                     set client_slug = 'ibath' where client_slug is null;
update outbound_webhooks            set client_slug = 'ibath' where client_slug is null;
update outbound_webhook_deliveries  set client_slug = 'ibath' where client_slug is null;
update agent_notifications          set client_slug = 'ibath' where client_slug is null;

-- Una vez backfilleado: NOT NULL + DEFAULT que toma el slug del header.
alter table profiles                     alter column client_slug set not null;
alter table conversations                alter column client_slug set not null;
alter table messages                     alter column client_slug set not null;
alter table agent_traces                 alter column client_slug set not null;
alter table agent_trace_steps            alter column client_slug set not null;
alter table agent_jobs                   alter column client_slug set not null;
alter table comments                     alter column client_slug set not null;
alter table outbound_webhooks            alter column client_slug set not null;
alter table outbound_webhook_deliveries  alter column client_slug set not null;
alter table agent_notifications          alter column client_slug set not null;

alter table profiles                     alter column client_slug set default current_client_slug();
alter table conversations                alter column client_slug set default current_client_slug();
alter table messages                     alter column client_slug set default current_client_slug();
alter table agent_traces                 alter column client_slug set default current_client_slug();
alter table agent_trace_steps            alter column client_slug set default current_client_slug();
alter table agent_jobs                   alter column client_slug set default current_client_slug();
alter table comments                     alter column client_slug set default current_client_slug();
alter table outbound_webhooks            alter column client_slug set default current_client_slug();
alter table outbound_webhook_deliveries  alter column client_slug set default current_client_slug();
alter table agent_notifications          alter column client_slug set default current_client_slug();

-- --- Indices por client_slug para filtros eficientes --------------------
create index on profiles                    (client_slug);
create index on conversations               (client_slug, updated_at desc);
create index on messages                    (client_slug, conversation_id, created_at);
create index on agent_traces                (client_slug, created_at desc);
create index on agent_trace_steps           (client_slug);
create index on agent_jobs                  (client_slug, status, created_at) where status in ('pending','processing');
create index on comments                    (client_slug, target_type, target_id);
create index on outbound_webhooks           (client_slug);
create index on outbound_webhook_deliveries (client_slug, created_at desc);
create index on agent_notifications         (client_slug, conversation_id, created_at desc);

-- --- Habilitar RLS y policies de tenant isolation -----------------------
-- Cada policy: SELECT/INSERT/UPDATE/DELETE solo filas del slug actual.
-- USING controla lectura/modificacion; WITH CHECK controla INSERT y los
-- cambios de client_slug. Combinados garantizan que no se puede ni ver ni
-- escribir filas de otro cliente.

alter table profiles                     enable row level security;
alter table conversations                enable row level security;
alter table messages                     enable row level security;
alter table agent_traces                 enable row level security;
alter table agent_trace_steps            enable row level security;
alter table agent_jobs                   enable row level security;
alter table comments                     enable row level security;
alter table outbound_webhooks            enable row level security;
alter table outbound_webhook_deliveries  enable row level security;
alter table agent_notifications          enable row level security;

create policy tenant_isolation on profiles
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on conversations
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on messages
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on agent_traces
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on agent_trace_steps
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on agent_jobs
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on comments
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on outbound_webhooks
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on outbound_webhook_deliveries
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on agent_notifications
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

-- NOTA SOBRE service_role:
--   El service_role bypassa RLS por diseno. Por eso el panel y el worker
--   van a dejar de usar service_role en runtime y van a usar la anon key
--   con el header X-Client-Slug. El service_role queda solo para tareas de
--   admin / migraciones (fuera de runtime).
