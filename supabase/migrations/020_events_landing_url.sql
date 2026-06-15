-- ===========================================================================
-- 020_events_landing_url.sql
--
-- Link de la landing / web del evento. Se carga desde el panel y entra en la
-- base de conocimiento del agente: la asistente puede compartir el link cuando
-- alguien quiere ver más detalle, y a futuro lo vamos a usar para derivar
-- ciertas consultas ("mirá la web") en vez de responderlas en el chat.
-- ===========================================================================

alter table events
  add column if not exists landing_url text;
