-- ===========================================================================
-- Limpieza histórica: notificaciones `validacion_pago` abiertas de pagos que
-- ya se revisaron. NO SE CORRIÓ. Correrla a mano, revisando primero el SELECT.
--
-- Por qué: hasta el 17/11/2026 validar, rechazar o descartar un comprobante no
-- completaba `agent_notifications.resolved_at`, así que quedaron ~685
-- notificaciones de pago abiertas para siempre. Desde ese día el panel las
-- resuelve al revisar el último comprobante pendiente de la conversación
-- (src/lib/interventions.ts). Esto pone al día el histórico con el mismo
-- criterio: se resuelven las de conversaciones que ya no tienen ningún
-- comprobante en estado `pending`.
--
-- Base COMPARTIDA: todo filtra por client_slug = 'vanesaruas'
-- (agent_notifications y payment_validations tienen la columna).
-- ===========================================================================

-- 1. Vista previa: cuántas se resolverían.
select count(*) as a_resolver
from agent_notifications n
where n.client_slug = 'vanesaruas'
  and n.category = 'validacion_pago'
  and n.resolved_at is null
  and not exists (
    select 1
    from payment_validations p
    where p.client_slug = 'vanesaruas'
      and p.conversation_id = n.conversation_id
      and p.status = 'pending'
  );

-- 2. Resolución (resolved_by queda null: la resolvió el sistema).
begin;

update agent_notifications n
set resolved_at = now()
where n.client_slug = 'vanesaruas'
  and n.category = 'validacion_pago'
  and n.resolved_at is null
  and not exists (
    select 1
    from payment_validations p
    where p.client_slug = 'vanesaruas'
      and p.conversation_id = n.conversation_id
      and p.status = 'pending'
  );

-- Revisar el número de filas afectadas contra la vista previa y recién ahí:
commit;
