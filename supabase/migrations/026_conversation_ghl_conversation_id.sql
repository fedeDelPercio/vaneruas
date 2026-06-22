-- ===========================================================================
-- 026_conversation_ghl_conversation_id.sql
--
-- Id de conversación de GoHighLevel (el thread). La URL de conversaciones de
-- GHL identifica el chat por SU conversationId (no por el contactId que vive en
-- external_id). Lo cacheamos acá para armar el deep-link directo al thread
-- exacto desde el panel ("Ver conversación"), sin resolverlo en vivo (que a
-- veces fallaba y caía a la bandeja, abriendo "la última" conversación).
--
-- Se completa en el inbound (la conversación que acaba de recibir el mensaje es
-- el thread correcto) y, como respaldo, al resolverlo on-read en el redirect.
-- ===========================================================================

alter table conversations
  add column if not exists ghl_conversation_id text;
