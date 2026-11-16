-- Lo que cobró el proveedor por cada llamada al modelo, en USD.
--
-- OpenRouter lo devuelve en `usage.cost` cuando el request pide
-- `usage: { include: true }` (ver llm-translate.ts). Anthropic directo no lo
-- manda: ahí queda null, que no es cero sino "no sabemos" (el informe mensual
-- estima esas llamadas con las tarifas de lista).
--
-- En el proyecto compartido la columna ya existía (la sumó otro panel sobre la
-- misma tabla public.agent_trace_steps); esto deja el esquema del repo al día
-- y no hace nada si ya está.
alter table public.agent_trace_steps
  add column if not exists cost_usd numeric(12, 6);

comment on column public.agent_trace_steps.cost_usd is
  'Lo que cobró el proveedor por la llamada (USD). Null si no lo informó.';
