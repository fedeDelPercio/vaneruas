-- ===========================================================================
-- 018_conversations_realtime.sql
--
-- La lista de conversaciones (ConversationList) ya se suscribe a UPDATE y
-- DELETE sobre `conversations` por realtime, pero la tabla no estaba en la
-- publicación `supabase_realtime`, así que esos eventos nunca llegaban. Efecto
-- visible: al renombrar un chat (que pasa en el panel) la sidebar no se
-- actualizaba hasta recargar. Sumar la tabla a la publicación hace que el
-- rename (y el borrado) se reflejen al instante.
-- ===========================================================================

alter publication supabase_realtime add table conversations;

-- REPLICA IDENTITY FULL: necesario para que los eventos UPDATE/DELETE de
-- realtime lleguen al browser pasando el filtro de RLS. Sin esto, el evento
-- viaja solo con la PK y Supabase Realtime no puede evaluar la policy de
-- tenant (client_slug) sobre la fila, así que NO lo entrega. Con INSERT no
-- hacía falta (la fila nueva viaja completa), por eso `messages` funcionaba.
alter table conversations replica identity full;
