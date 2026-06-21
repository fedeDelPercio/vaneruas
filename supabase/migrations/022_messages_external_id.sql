-- ===========================================================================
-- 022_messages_external_id.sql
--
-- Id externo del mensaje (el messageId de GHL). Se usa para deduplicar: cuando
-- el agente envía por la API de GHL, guardamos el messageId que devuelve; así,
-- cuando llegue el webhook OutboundMessage de la app de GHL con ese mismo id,
-- sabemos que el mensaje es nuestro (lo generó la IA) y no lo re-ingerimos como
-- si fuera de un humano. Los mensajes humanos (escritos por el asesor en GHL)
-- no van a matchear ningún id nuestro y se guardan como role="human".
-- ===========================================================================

alter table messages
  add column if not exists external_id text;

-- Lookup rápido para el dedup por messageId de GHL.
create index if not exists messages_external_id_idx
  on messages (external_id)
  where external_id is not null;
