-- ===========================================================================
-- Cascade manual para comments al borrar conversations o messages.
--
-- comments.target_id es polimorfico (puede ser un conversation_id o un
-- message_id segun target_type), por eso no tiene FK directa y el ON DELETE
-- CASCADE de Postgres no lo limpia solo. Estos triggers cierran ese hueco:
-- al borrar una conversation o un message, se borran los comments que
-- apuntaban a esa fila.
--
-- Defensa en profundidad: ya el endpoint DELETE de /api/conversations
-- dispara el cascade en la mayoria de las tablas via las FKs; el trigger
-- garantiza que comments tambien queden consistentes aunque alguien borre
-- por SQL directo, scripts admin, o cualquier otra via.
-- ===========================================================================

create or replace function cleanup_comments_on_conversation_delete()
returns trigger language plpgsql as $$
begin
  delete from comments
  where target_type = 'conversation' and target_id = old.id;
  return old;
end;
$$;

create or replace function cleanup_comments_on_message_delete()
returns trigger language plpgsql as $$
begin
  delete from comments
  where target_type = 'message' and target_id = old.id;
  return old;
end;
$$;

create trigger comments_cleanup_on_conversation_delete
  after delete on conversations
  for each row execute function cleanup_comments_on_conversation_delete();

-- Al borrar una conversation, las messages cascade-delete via la FK. Cada
-- DELETE en messages dispara este trigger y limpia sus comments.
create trigger comments_cleanup_on_message_delete
  after delete on messages
  for each row execute function cleanup_comments_on_message_delete();
