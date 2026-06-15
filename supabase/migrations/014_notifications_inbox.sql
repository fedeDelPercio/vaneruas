-- ===========================================================================
-- Bandeja de derivaciones al equipo (cliente Nueva Piel / Vanesa Rúas).
--
-- El panel /interventions lista las notificaciones del agente que implican
-- intervención del equipo (todo menos `validacion_pago`, que tiene su propio
-- módulo en /payments). Para que sea una bandeja de trabajo y no solo un feed,
-- se suma un estado "resuelta" (quién y cuándo la atendió).
--
-- Además se amplía el CHECK de category con dos valores que el CÓDIGO ya emite
-- (`src/lib/agent/run.ts`) pero que no estaban en el constraint del proyecto
-- compartido: `escalado_manual` y `falla_tecnica`. Sin esto, esas derivaciones
-- fallaban al insertar (mismo problema que `validacion_pago`, ver migración
-- 013) y nunca llegaban ni al email ni a la bandeja. Ver memoria
-- `project_shared_db_category_check_drift`.
-- ===========================================================================

-- --- 1. Ampliar el CHECK de category (aditivo) -----------------------------
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
    'falla_tecnica'
  ]));

-- --- 2. Estado de resolución de la derivación ------------------------------
alter table agent_notifications add column if not exists resolved_at timestamptz;
alter table agent_notifications
  add column if not exists resolved_by uuid references profiles(id) on delete set null;

-- Índice para la bandeja: por cliente, pendientes/resueltas, más recientes primero.
create index if not exists agent_notifications_inbox_idx
  on agent_notifications (client_slug, resolved_at, created_at desc);
