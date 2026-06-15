-- ===========================================================================
-- 015_events.sql — Catálogo dinámico de eventos (masterclass / congreso).
--
-- Los eventos del cliente (Nueva Piel) dejan de vivir hardcodeados en la KB
-- (`knowledge-base.md`) y pasan a una tabla editable desde el panel. Cada 1-2
-- meses sale una masterclass nueva: el cliente la carga desde la UI, le pone
-- precios y fecha de lanzamiento, y el agente la empieza a comunicar solo
-- cuando corresponde, sin tocar prompts ni reiniciar el server.
--
-- El agente solo "ve" eventos con status 'activo' cuya fecha de lanzamiento
-- (announce_at) ya pasó (o es nula). 'borrador' y 'archivado' quedan ocultos.
-- ===========================================================================

create table if not exists events (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  -- Tipo de evento. Acotado: masterclass puntual o el congreso anual.
  kind  text not null check (kind in ('masterclass', 'congress')),

  -- Fecha de lanzamiento: a partir de cuándo el agente lo comunica. Si es
  -- nula, se comunica apenas pase a 'activo'.
  announce_at timestamptz,
  -- Fecha en que ocurre el evento.
  event_at    timestamptz,

  -- Precio con tarjeta, expresado como cuotas x monto por cuota (ARS).
  card_installments       int,
  card_installment_amount numeric(14, 2),
  -- Precio por transferencia (ARS).
  transfer_price          numeric(14, 2),
  -- Precio para pagos internacionales (USD).
  international_price      numeric(14, 2),

  -- Bloque grande de detalle: todo lo que el agente puede afirmar del evento
  -- (modalidad, lugar, qué incluye, certificación, FAQ puntual). Se inyecta
  -- tal cual en la base de conocimiento del agente.
  details text,

  -- Ciclo de vida. 'borrador': se está armando, el agente no lo ve.
  -- 'activo': el agente lo comunica (respetando announce_at). 'archivado':
  -- evento pasado u oculto, fuera del catálogo en vivo.
  status text not null default 'borrador'
    check (status in ('borrador', 'activo', 'archivado')),

  -- Multi-tenant: aislamiento por cliente vía RLS.
  client_slug text not null default current_client_slug(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- El panel lista por cliente y ordena por fecha de evento; el agente filtra
-- por status. Un índice cubre ambos accesos.
create index if not exists events_client_status_idx
  on events (client_slug, status, event_at);

-- RLS: cada cliente solo ve y escribe sus propios eventos.
alter table events enable row level security;

drop policy if exists tenant_isolation on events;
create policy tenant_isolation on events
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

-- Realtime: el panel refresca la lista al vuelo cuando se crea/edita/borra.
alter publication supabase_realtime add table events;
