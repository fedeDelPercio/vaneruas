-- ===========================================================================
-- 031_messages_external_id_unique.sql
--
-- El importador de mensajes del equipo (src/lib/providers/ghl-human.ts) corre
-- cada 5 minutos y vuelve a mirar una ventana solapada, así que necesita que la
-- base garantice que un mismo messageId de GHL no entre dos veces. Hasta ahora
-- external_id tenía solo un índice de lookup, no de unicidad: el dedup vivía
-- entero en el código (un select previo), que no protege contra dos corridas en
-- paralelo.
--
-- Verificado antes de aplicar: 8.463 external_id distintos, 0 duplicados.
-- El índice es parcial (where not null) porque los mensajes de test y los
-- carteles de sistema no tienen id externo.
-- ===========================================================================

drop index if exists messages_external_id_idx;

create unique index if not exists messages_external_id_key
  on messages (external_id)
  where external_id is not null;
