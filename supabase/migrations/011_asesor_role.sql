-- ===========================================================================
-- 011_asesor_role.sql
--
-- Suma 'asesor' a los roles válidos de profiles. El asesor gestiona
-- conversaciones reales (WhatsApp + cualquier modulo operativo que el
-- cliente sume). Los accesos por ruta se controlan client-side en
-- src/lib/profile.ts (tabla ROLE_ACCESS).
-- ===========================================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('dev', 'client', 'asesor'));
