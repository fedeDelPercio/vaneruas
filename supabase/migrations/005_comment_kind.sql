-- ===========================================================================
-- Tipo de comentario: reaccion positiva / negativa / nota.
--
-- Las reacciones (positive | negative) son un toggle por perfil y mensaje:
-- cada perfil puede tener una sola por mensaje (la unicidad la enforce un
-- indice parcial). Las notas siguen pudiendo ser multiples por mensaje.
--
-- Positive y negative son mutuamente excluyentes desde el lado del API
-- (no desde DB): al setear una, el endpoint borra la opuesta del mismo autor.
-- ===========================================================================

alter table comments add column kind text;
update comments set kind = 'note' where kind is null;
alter table comments alter column kind set not null;
alter table comments alter column kind set default 'note';
alter table comments add constraint comments_kind_check
  check (kind in ('positive','negative','note'));

-- Unicidad parcial: cada perfil tiene como mucho una reaccion (positive o
-- negative) por target. Las notas no tienen esta restriccion.
create unique index comments_reaction_unique
  on comments (target_id, author_id, kind)
  where kind in ('positive','negative');

-- Index para leer reacciones de un set de mensajes en una query.
create index comments_target_kind_idx
  on comments (target_type, target_id, kind);
