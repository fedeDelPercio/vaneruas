-- ===========================================================================
-- agentic-testing-panel — migracion inicial (fase 1)
-- ===========================================================================
-- NOTA DE SEGURIDAD: en fase 1 NO se habilita Row Level Security. No hay auth
-- real, los perfiles son solo nombres. Activar RLS + Supabase Auth es deuda
-- tecnica de fase 2 (ver README > "Deuda tecnica conocida").
-- ===========================================================================

-- Perfiles del panel (fase 1: sin auth real, solo nombres)
create table profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text check (role in ('dev','client')) not null default 'client',
  created_at timestamptz not null default now()
);

-- Conversaciones de prueba (fase 1) o reales (fase 2)
create table conversations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  source text check (source in ('test','whatsapp')) not null default 'test',
  external_id text,                   -- phone en fase 2, null en test
  status text check (status in ('active','archived')) not null default 'active',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on conversations(updated_at desc);

-- Mensajes
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text check (role in ('user','assistant','system','human')) not null,
  content text not null,
  trace_id uuid,                      -- FK suave a agent_traces
  created_at timestamptz not null default now()
);
create index on messages(conversation_id, created_at);

-- Trace agentico (un trace por respuesta del agente)
create table agent_traces (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_message_id uuid references messages(id),
  assistant_message_id uuid references messages(id),
  status text check (status in ('running','completed','escalated','failed')) not null,
  iterations int not null default 0,
  total_input_tokens int not null default 0,
  total_output_tokens int not null default 0,
  total_latency_ms int not null default 0,
  evaluator_passed boolean,
  escalation_reason text,
  provider text check (provider in ('anthropic','openrouter')) not null default 'anthropic',
  created_at timestamptz not null default now()
);
create index on agent_traces(created_at desc);
create index on agent_traces(conversation_id);

-- Steps individuales del trace (orquestador, subagentes, tools, evaluator)
create table agent_trace_steps (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references agent_traces(id) on delete cascade,
  step_order int not null,
  step_type text check (step_type in ('orchestrator','subagent','tool','evaluator')) not null,
  step_name text not null,
  iteration int not null default 1,
  model text not null,
  provider text check (provider in ('anthropic','openrouter')) not null,
  input jsonb,
  output jsonb,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  latency_ms int not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index on agent_trace_steps(trace_id, step_order);

-- Job queue para procesamiento asincrono del agente
create table agent_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_message_id uuid not null references messages(id) on delete cascade,
  status text check (status in ('pending','processing','completed','failed')) not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 3,
  error text,
  trace_id uuid references agent_traces(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index on agent_jobs(status, created_at) where status in ('pending','processing');
create index on agent_jobs(conversation_id, created_at desc);

-- Comentarios de feedback firmados por perfil
create table comments (
  id uuid primary key default gen_random_uuid(),
  target_type text check (target_type in ('conversation','message')) not null,
  target_id uuid not null,            -- conversation_id o message_id
  author_id uuid not null references profiles(id),
  content text not null,
  created_at timestamptz not null default now()
);
create index on comments(target_type, target_id, created_at);

-- Webhooks salientes (configurables desde el tab Webhooks)
create table outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  events text[] not null,
  secret text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Registro de entregas de webhooks salientes (para debugging)
create table outbound_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references outbound_webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  response_status int,
  response_body text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index on outbound_webhook_deliveries(webhook_id, created_at desc);

-- Habilitar Supabase Realtime en las tablas que el panel observa en vivo.
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table agent_traces;
alter publication supabase_realtime add table agent_jobs;
alter publication supabase_realtime add table comments;
