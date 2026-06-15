-- ===========================================================================
-- 021_conversation_contact_email.sql
--
-- Correo de la contacta. Después de validar el pago, la asistente le pide el
-- mail para darle el acceso al curso; lo guardamos acá. Por ahora vive en ATP;
-- el paso siguiente es sincronizar este campo con GHL (y usarlo para el alta
-- en Tiendup).
-- ===========================================================================

alter table conversations
  add column if not exists contact_email text;
