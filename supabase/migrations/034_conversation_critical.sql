-- ===========================================================================
-- 034_conversation_critical.sql
--
-- Tag "Crítico" de una conversación: un clasificador barato (Haiku) marca las
-- conversaciones donde la contacta está enojada, reclama de mala manera,
-- amenaza con denunciar o escrachar, o repite un reclamo sin respuesta. El
-- equipo lo ve en /wa y /revision y lo puede limpiar a mano.
--
--   critical               true = marcada como crítica. null/false = no.
--   critical_reason        motivo corto (máx. 120 caracteres) que dio el modelo.
--   critical_at            cuándo se marcó.
--   critical_evaluated_at  created_at del último mensaje de la contacta que ya
--                          se evaluó. Solo se re-evalúa si entra uno posterior.
--
-- OJO: `conversations` es COMPARTIDA con otros tenants (iBath, Scaglia,
-- Quintaglia, stag). Por eso:
--   - Columnas nullable y SIN default: en Postgres agregar una columna así es
--     solo metadata (no reescribe la tabla ni bloquea más que un instante).
--   - No se actualiza ninguna fila: los otros tenants quedan con null y no
--     ven ni usan nada de esto.
--   - Sin índice nuevo: la tabla es chica y el filtro "Críticos" va junto con
--     el índice (client_slug, updated_at) que ya existe.
--   - RLS: la policy tenant_isolation de conversations (004) ya cubre las
--     columnas nuevas; no hace falta policy aparte.
--
-- Idempotente. El panel y el worker funcionan sin esta migración (detectan
-- la columna faltante, 42703 / PGRST204, y siguen sin el tag).
-- ===========================================================================

alter table public.conversations
  add column if not exists critical boolean,
  add column if not exists critical_reason text,
  add column if not exists critical_at timestamptz,
  add column if not exists critical_evaluated_at timestamptz;

comment on column public.conversations.critical is
  'Tag "Crítico" (clasificador LLM, panel vaneruas). null/false = no crítica.';
comment on column public.conversations.critical_evaluated_at is
  'created_at del último mensaje de la contacta evaluado por el clasificador de "Crítico".';
