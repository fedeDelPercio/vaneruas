-- ===========================================================================
-- Categoría de notificación 'validacion_pago' (cliente Vanesa Rúas).
--
-- Contexto: la migración 003 creó agent_notifications.category como texto
-- libre SIN check constraint, a propósito ("para mantener el schema
-- reutilizable entre clientes"). Sin embargo el proyecto Supabase compartido
-- tiene un check (`agent_notifications_category_check`) agregado fuera de
-- banda que limita category a un set fijo de valores. Ese check NO incluía
-- 'validacion_pago', así que el insert de la notificación de comprobante (ver
-- src/lib/payments/register.ts) fallaba con violación de constraint, y de paso
-- tapaba el email + webhook al equipo (mismo try/catch). El email ya se hizo
-- resiliente; esta migración destraba el insert de la notificación interna.
--
-- Fix aditivo (no cambia el comportamiento de otras categorías ya permitidas):
-- recrear el check sumando 'validacion_pago'. Es idempotente: dropea el check
-- si existe y lo vuelve a crear con el set ampliado.
--
-- Nota: el set "canónico" sigue dependiendo del prompt de cada cliente; este
-- check es defensivo. Si en el futuro se decide volver al diseño original
-- (sin check, ver migración 003), alcanza con dropear el constraint.
-- ===========================================================================

alter table agent_notifications
  drop constraint if exists agent_notifications_category_check;

alter table agent_notifications
  add constraint agent_notifications_category_check
  check (category = any (array[
    'arquitecto_desarrollador',
    'cantidad_equipos',
    'interes_compra',
    'cliente_existente',
    'fuera_de_conocimiento',
    'validacion_pago'
  ]));
