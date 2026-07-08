-- ===========================================================================
-- 029_payment_course_access.sql
--
-- Entrega de acceso al curso (Tiendup). Cuando se le da acceso a la masterclass
-- a la persona (inscripción en Tiendup por email), lo registramos en el
-- comprobante para saber que ya se hizo (evitar duplicar) y mostrar el estado en
-- Aprobaciones. Si el enroll falla, guardamos el error para revisión.
--
--  - course_access_granted_at: cuándo se dio el acceso al curso (null = no dado).
--  - course_access_error: detalle del último error al intentar dar acceso.
-- ===========================================================================

alter table payment_validations
  add column if not exists course_access_granted_at timestamptz,
  add column if not exists course_access_error text;
