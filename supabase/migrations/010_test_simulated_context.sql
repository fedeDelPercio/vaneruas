-- ===========================================================================
-- 010_test_simulated_context.sql
--
-- Para el panel de testing de iBath: cuando se crea una conversación de
-- prueba, el operador puede simular el momento en que el cliente "escribe"
-- y marcar si el contacto ya está registrado (en Kommo). Estos campos solo
-- aplican a conversations.source = 'test'; en producción (source =
-- 'whatsapp') el contexto se calcula con el reloj real y la marca de
-- cliente existente la trae la integración Kommo aparte.
-- ===========================================================================

alter table conversations
  add column if not exists simulated_timestamp timestamptz null,
  add column if not exists is_existing_customer boolean not null default false;

comment on column conversations.simulated_timestamp is
  'Solo para source=test: timestamp que el agente debe usar como "ahora" en lugar del reloj real. Permite probar respuestas dentro/fuera de horario comercial sin esperar.';

comment on column conversations.is_existing_customer is
  'Solo para source=test: si está en true, el agente trata al cliente como ya registrado (deriva con cliente_existente). En producción, esto lo trae la integración con Kommo.';
