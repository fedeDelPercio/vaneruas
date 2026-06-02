-- ===========================================================================
-- Notificaciones al equipo.
--
-- Cada vez que el agente detecta un disparador, registra una notificación.
-- La conversación queda "congelada": el agente no responde más y el equipo
-- toma el control.
--
-- `category` es texto libre (snake_case): cada cliente define sus propias
-- categorías en el prompt del orquestador. No se aplica CHECK constraint
-- para mantener el schema reutilizable entre clientes; la consistencia se
-- mantiene en el prompt del cliente.
-- ===========================================================================

create table agent_notifications (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  trace_id uuid references agent_traces(id) on delete set null,
  category text not null,
  reason text,
  summary text,
  created_at timestamptz not null default now()
);
create index on agent_notifications(conversation_id, created_at desc);

alter publication supabase_realtime add table agent_notifications;
