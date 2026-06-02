-- Modo por defecto que se aplica a NUEVAS conversaciones WhatsApp.
-- Default HUMAN: durante las pruebas con WhatsApp personal evita auto-responder
-- a contactos que no se quieren testear. El operador activa AI por chat.
alter table wa_connection_state
  add column if not exists default_mode text not null default 'HUMAN'
  check (default_mode in ('AI','HUMAN'));
