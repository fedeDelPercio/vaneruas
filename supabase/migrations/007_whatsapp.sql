-- ===========================================================================
-- 007_whatsapp.sql — Integración con WhatsApp via Baileys.
--
-- El bot de Baileys corre fuera de Vercel (en Easypanel) y se comunica con
-- el panel a través de estas tablas en Supabase. Schema ya tiene parte:
--   conversations.source ('test'|'whatsapp') ✓
--   conversations.external_id (lo usamos como phone) ✓
--   messages.role incluye 'human' ✓
--
-- Falta: el modo AI/HUMAN por conversación, el estado de la conexión
-- WhatsApp por cliente, y la cola de mensajes humanos (panel → bot).
-- ===========================================================================

-- Modo AI / HUMAN por conversación.
alter table conversations
  add column mode text not null default 'AI'
  check (mode in ('AI', 'HUMAN'));

-- Estado de conexión WhatsApp (una row por client_slug). Sirve de "buzón"
-- entre el bot (proceso en Easypanel) y el panel (Vercel). El bot escribe
-- el QR cuando lo recibe, el panel lo lee y lo muestra. Cuando se conecta,
-- el bot setea phone + status='connected' y el panel transiciona la UI.
create table wa_connection_state (
  client_slug text primary key default current_client_slug(),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'qr', 'connecting', 'connected')),
  qr_string text,
  phone text,
  last_error text,
  updated_at timestamptz not null default now()
);

-- Seed inicial: row para el cliente activo de este worktree/deploy. Usa
-- current_client_slug() para que no hardcodee un slug específico (el
-- template no asume nombre de cliente). Si current_client_slug() devuelve
-- null porque no hay JWT seteado al correr la migración, el insert se
-- skipea silenciosamente.
insert into wa_connection_state (client_slug)
  select current_client_slug()
  where current_client_slug() is not null
  on conflict (client_slug) do nothing;

-- Outbox: mensajes humanos que el panel encola para que el bot envíe via
-- Baileys. El bot polea cada 2s. `sent_at` null = pendiente. Si falla,
-- incrementa `attempts` y deja `sent_at` null para reintento.
create table wa_outbox (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references conversations(id) on delete cascade,
  phone text not null,
  content text not null,
  sent_at timestamptz,
  error text,
  attempts int not null default 0,
  client_slug text not null default current_client_slug(),
  created_at timestamptz not null default now()
);

create index wa_outbox_pending_idx
  on wa_outbox (client_slug, created_at)
  where sent_at is null;

-- Cuando el bot envía un mensaje del assistant via Baileys, marca aquí
-- para no reintentarlo y para mostrar tilde de "entregado" en el panel.
alter table messages add column delivered_at timestamptz;

-- RLS por client_slug (mismo patrón que el resto de tablas).
alter table wa_connection_state enable row level security;
alter table wa_outbox enable row level security;

create policy tenant_isolation on wa_connection_state
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

create policy tenant_isolation on wa_outbox
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());
