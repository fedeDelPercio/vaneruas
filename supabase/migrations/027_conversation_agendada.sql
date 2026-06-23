-- ===========================================================================
-- 027_conversation_agendada.sql
--
-- Flag de "agendada": el módulo Agendar es un worklist de los contactos de
-- WhatsApp que el equipo todavía tiene que dar de alta (en GHL y, según el
-- caso, en grupos de WhatsApp). Cuando el equipo lo agenda, lo tilda y sale de
-- la lista. Default false = todavía hay que agendarlo.
--
-- Backfill: a quienes YA son clientas (pagaron / acreditaron título) las damos
-- por agendadas, para que el módulo arranque solo con los contactos que
-- realmente faltan. Scope a vanesaruas (único cliente que usa el módulo hoy).
-- ===========================================================================

alter table conversations
  add column if not exists agendada boolean not null default false;

update conversations
  set agendada = true
  where is_existing_customer = true and client_slug = 'vanesaruas';
