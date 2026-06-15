-- ===========================================================================
-- 019_title_review.sql
--
-- El panel de Pagos ahora también muestra los títulos profesionales a validar
-- (los que la IA no pudo dar por buenos) para que una persona del equipo los
-- revise a mano: validar (habilita el comprobante retenido) o rechazar. Para
-- eso necesitamos marcar cuándo y quién revisó un título.
--
--  - reviewed_at / reviewed_by: sello de la revisión manual. Un título a
--    revisar = is_valid=false AND reviewed_at IS NULL. Cuando el equipo lo
--    valida, is_valid pasa a true y se sella reviewed_at/by; cuando lo rechaza,
--    is_valid queda false pero reviewed_at se sella (sale de la cola).
-- ===========================================================================

alter table professional_titles
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references profiles(id) on delete set null;

create index if not exists professional_titles_review_idx
  on professional_titles (client_slug, reviewed_at, created_at desc);

-- Realtime: que el panel de Pagos se actualice solo cuando entra o cambia un
-- título a revisar. Igual que conversations (016/018), UPDATE necesita REPLICA
-- IDENTITY FULL para pasar el filtro de RLS por tenant.
alter publication supabase_realtime add table professional_titles;
alter table professional_titles replica identity full;
