-- ===========================================================================
-- Módulo Certificados: reclamos de certificados/diplomas de masterclass.
--
-- Tras cada masterclass se envía un certificado de asistencia. Algunas
-- asistentes reclaman que no les llegó. El agente deriva esos casos con la
-- categoría `reclamo_certificado`, que vive en su propio módulo /certificados
-- (igual que `validacion_pago` vive en /payments). Esos reclamos NO entran a la
-- bandeja de /interventions (se excluyen igual que los comprobantes).
--
-- Esta migración SOLO amplía el CHECK de category (aditivo): preserva las 8
-- categorías ya existentes y suma `reclamo_certificado`. Sin esto, el insert de
-- la notificación falla en silencio y el reclamo nunca llega ni al email ni al
-- panel (mismo problema que documenta la memoria
-- `project_shared_db_category_check_drift`). DB compartida multi-tenant: la
-- constraint viva se verificó idéntica a la migración 014 antes de recrearla.
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
    'validacion_pago',
    'escalado_manual',
    'falla_tecnica',
    'reclamo_certificado'
  ]));
