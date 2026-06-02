-- ===========================================================================
-- Funcion para reclamar jobs de forma atomica.
--
-- Toma hasta p_limit jobs en estado 'pending', los marca 'processing' e
-- incrementa attempts, todo en una sola sentencia. `for update skip locked`
-- evita que dos workers concurrentes tomen el mismo job.
-- ===========================================================================

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
    order by created_at
    for update skip locked
    limit p_limit
  )
  returning *;
$$;
