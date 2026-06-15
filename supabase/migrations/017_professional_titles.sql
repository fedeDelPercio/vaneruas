-- ===========================================================================
-- 017_professional_titles.sql
--
-- Validación de título profesional antes de aprobar un comprobante.
--
-- Regla de negocio: una persona que NO está registrada como contacto (hoy se
-- modela con conversations.is_existing_customer; a futuro será GHL) y que manda
-- un comprobante de pago, primero tiene que acreditar que es cosmetóloga (o
-- afín). Le pedimos el título, una IA valida que sea un certificado real, se
-- guarda acá, y recién entonces el comprobante se manda a aprobar.
--
--  - professional_titles: un registro por título recibido (válido o no), con
--    lo que leyó la IA.
--  - payment_validations.awaiting_title: el comprobante quedó retenido a la
--    espera del título; no se notifica al equipo hasta liberarlo.
-- ===========================================================================

create table if not exists professional_titles (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid references conversations(id) on delete set null,
  message_id      uuid references messages(id) on delete set null,

  -- Archivo del título en el bucket `comprobantes` (mismo bucket que los
  -- comprobantes; el adjunto se sube por el mismo flujo).
  file_path text,
  file_type text,

  -- Lo que leyó la IA del título.
  holder_name text,
  title_name  text,
  institution text,
  confidence  text,
  extraction  jsonb,

  -- Veredicto de la IA: ¿es un certificado/título profesional válido?
  is_valid        boolean not null default false,
  validation_note text,

  client_slug text not null default current_client_slug(),
  created_at  timestamptz not null default now()
);

create index if not exists professional_titles_conv_idx
  on professional_titles (client_slug, conversation_id, created_at desc);

alter table professional_titles enable row level security;

drop policy if exists tenant_isolation on professional_titles;
create policy tenant_isolation on professional_titles
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

-- Comprobante retenido a la espera de validar el título profesional.
alter table payment_validations
  add column if not exists awaiting_title boolean not null default false;
