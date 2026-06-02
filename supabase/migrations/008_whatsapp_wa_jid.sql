-- Guardar el JID completo del contacto (`<id>@s.whatsapp.net` o `<id>@lid`)
-- para poder rutear correctamente el envío saliente desde el outbox.
-- external_id se mantiene como dígitos para retrocompat y display.
alter table conversations add column if not exists wa_jid text;
