-- Tokens de prompt caching por step, para poder medir el ahorro real.
--
-- Hasta ahora `input_tokens` guardaba el total de entrada (incluyendo lo que
-- vino del cache) y no había forma de saber qué proporción se cobró a 0.1x.
-- Con OpenRouter el dato viene en `usage.prompt_tokens_details`
-- (`cached_tokens` / `cache_write_tokens`); con Anthropic directo viene en
-- `cache_read_input_tokens` / `cache_creation_input_tokens`.
--
-- Convención: `input_tokens` sigue siendo el TOTAL de entrada (fresco + cache),
-- así los reportes viejos no cambian de significado. Estas dos columnas son el
-- desglose: cuánto de ese total fue lectura de cache (barato) y cuánto fue
-- escritura de cache (1.25x). Nullable: los steps anteriores no lo tienen.
alter table public.agent_trace_steps
  add column if not exists cache_read_tokens integer,
  add column if not exists cache_write_tokens integer;

comment on column public.agent_trace_steps.cache_read_tokens is
  'Subconjunto de input_tokens que se leyó del prompt cache (se cobra 0.1x).';
comment on column public.agent_trace_steps.cache_write_tokens is
  'Subconjunto de input_tokens que se escribió al prompt cache (se cobra 1.25x).';
