-- ===========================================================================
-- 028_payment_delivery_failed.sql
--
-- Aviso de "no se pudo avisar al cliente". Cuando se aprueba un comprobante, le
-- mandamos la confirmación por WhatsApp. Si ese envío falla (típico: pasaron las
-- 24 horas de la ventana de WhatsApp/Meta y el mensaje libre ya no sale), antes
-- el error se tragaba en silencio. Ahora lo marcamos en el comprobante para que
-- el equipo lo vea en Aprobaciones e intervenga a mano.
--
--  - delivery_failed: true si el último intento de avisar al cliente falló.
--  - delivery_error: detalle del error (para diagnóstico / mostrar contexto).
-- ===========================================================================

alter table payment_validations
  add column if not exists delivery_failed boolean not null default false,
  add column if not exists delivery_error text;
