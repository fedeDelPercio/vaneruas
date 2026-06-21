-- ===========================================================================
-- Debounce / acumulación de mensajes (cliente vanesaruas, pero compatible con
-- todos los clientes de la DB compartida).
--
-- Las personas suelen mandar varios mensajes seguidos por WhatsApp. En vez de
-- responder cada uno por separado, esperamos un período de silencio y
-- consolidamos la respuesta. Para eso el job no se procesa hasta que pasa su
-- `process_after`: el inbound de WhatsApp lo setea a `now() + ventana`, y lo
-- empuja con cada mensaje nuevo (la lógica de "empujar" vive en el worker, que
-- re-difiere el job si llegó un mensaje dentro de la ventana).
--
-- BACKWARD-COMPATIBLE: `process_after` defaultea a `now()`, así que todos los
-- jobs existentes y los flujos que no setean el campo (panel de Testing, otros
-- clientes) quedan reclamables de inmediato. El debounce solo se activa cuando
-- el inbound setea `process_after` en el futuro (conversaciones de WhatsApp).
-- ===========================================================================

alter table agent_jobs
  add column if not exists process_after timestamptz not null default now();

-- Índice para el claim: pendientes cuyo período ya venció, más viejos primero.
create index if not exists agent_jobs_pending_process_after_idx
  on agent_jobs (process_after)
  where status = 'pending';

-- El claim ahora ignora los jobs cuyo `process_after` todavía no llegó.
create or replace function claim_agent_jobs(p_limit int)
returns setof agent_jobs
language sql
as $$
  update agent_jobs
  set status = 'processing',
      started_at = now(),
      attempts = attempts + 1
  where id in (
    select id from agent_jobs
    where status = 'pending'
      and process_after <= now()
    order by process_after
    for update skip locked
    limit p_limit
  )
  returning *;
$$;
