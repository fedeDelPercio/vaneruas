-- ===========================================================================
-- Dedup de adjuntos entrantes de WhatsApp por URL de origen (GHL).
--
-- Cuando una persona manda VARIOS adjuntos (ej. dos comprobantes), GHL los
-- recibe como mensajes separados y el inbound puede correr varias veces sobre
-- la misma conversación. Para procesar cada adjunto UNA sola vez (sin perder
-- ninguno ni duplicar), guardamos la URL del adjunto en GHL y deduplicamos
-- contra ella. Aditivo y backward-compatible (columna nullable).
-- ===========================================================================

alter table messages
  add column if not exists attachment_source_url text;

-- Para el lookup de dedup: ¿ya procesamos esta URL en esta conversación?
create index if not exists messages_attachment_source_url_idx
  on messages (conversation_id, attachment_source_url)
  where attachment_source_url is not null;
