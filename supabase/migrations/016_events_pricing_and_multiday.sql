-- ===========================================================================
-- 016_events_pricing_and_multiday.sql
--
-- Dos ajustes al módulo de eventos:
--
--  1. Eventos multi-día: el congreso dura 2 días (sáb + dom). Sumamos
--     `event_end_at` opcional para representar el día de cierre. Si es nulo,
--     el evento es de un solo día (`event_at`).
--
--  2. Precio con tarjeta como TOTAL + cuotas: antes guardábamos monto por
--     cuota; ahora guardamos el precio total con tarjeta (`card_total`) y la
--     cantidad de cuotas (`card_installments`). El monto por cuota se calcula
--     solo (total / cuotas). Más natural para el cliente: piensa el precio
--     final, no el de cada cuota.
-- ===========================================================================

alter table events add column if not exists event_end_at timestamptz;
alter table events add column if not exists card_total numeric(14, 2);

-- La tabla todavía no tiene datos en producción para este cliente: el monto
-- por cuota se reemplaza por el total. Si hubiera datos, habría que backfillear
-- card_total = card_installments * card_installment_amount antes de dropear.
alter table events drop column if exists card_installment_amount;
