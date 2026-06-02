# atp-template

Plantilla base de **ATP** (Agentic Testing Panel). Repo de partida para
arrancar un cliente nuevo: panel Next.js + agente (orquestador + evaluator)
+ harness de evals + notificaciones por email + multi-tenant via RLS.

**Cómo se usa:** clonás este repo, lo configurás, y customizás los
prompts / KB / brand / features según el cliente. No es una librería que
se instala: es un punto de partida que se copia y se hace propio.

## Lo que ya viene resuelto

- **Panel Next.js 15** con shell de Testing, Conversaciones, Webhooks y
  Dashboard. Diseño dark/light. Geist + Tailwind, sin librería de UI.
- **Agent loop completo:** orquestador (`claude-sonnet-4-6` por default),
  evaluator (`claude-haiku-4-5`) con reintentos hasta
  `AGENT_MAX_ITERATIONS`, sanitización de estilo determinística (sin
  emojis, sin `¿/¡`, sin em dash, sin bold markdown, sin punto final).
- **Multi-tenant** via RLS + claim `client_slug` del JWT (un solo proyecto
  Supabase puede alojar N clientes sin riesgo de mezclar datos).
- **Worker de jobs** (`/api/jobs/process`) con cron de Vercel cada minuto
  y auto-trigger desde el webhook entrante.
- **Webhooks salientes** firmados HMAC para eventos del agente
  (`agent.responded`, `agent.escalated`, `agent.failed`).
- **Notificaciones por email** al equipo (Gmail SMTP + App Password) en
  cada notificación nueva del agente (`agent_notifications`). Skip
  silencioso si no se configuran las env vars.
- **Falla técnica reactiva**: si el orquestador tira excepción (límite de
  API, timeout, etc.), NO se le manda al cliente un "Disculpá..."; se
  registra notificación con categoría `falla_tecnica` para que un humano
  tome la conversación.
- **Harness de evals** (`npm run eval`): corre el orquestador real contra
  escenarios multi-turno con aserciones automáticas. Sumá escenarios a
  medida que descubras casos críticos del cliente.

## Lo que tenés que customizar

| Path | Qué hacer |
|---|---|
| `src/lib/agent/prompts/orchestrator.md` | Persona del asistente, flow, disparadores, wording de cierre. |
| `src/lib/agent/prompts/knowledge-base.md` | Toda la info del cliente (empresa, productos/servicios, FAQ, contactos). |
| `src/lib/agent/prompts/evaluator.md` | Solo si querés ajustar criterios (el base es genérico). |
| `src/components/BrandLogo.tsx` | Sobrescribí con el logo del cliente (ver patrón en `CLAUDE.md`). |
| `src/components/SplashScreen.tsx` | Si querés splash de bienvenida por-cliente. |
| `public/brand-logo.png` | PNG con fondo transparente, trazo blanco. |
| `scripts/evals/scenarios.ts` | Sumá escenarios de eval para los casos críticos del cliente. |
| `.env.local` | Credenciales (Supabase, Anthropic, Gmail si aplica). |

## Setup local

### Requisitos
- Node.js >= 20.9
- Una cuenta Supabase + API key de Anthropic

### Pasos
1. Clonar este repo en una carpeta nueva por cliente (ej. `atp-<cliente>`).
2. Cambiar `name` en `package.json` y el puerto en el script `dev` si lo
   querés correr al lado de otros clientes.
3. `cp .env.example .env.local` y completar. Mínimo necesario para
   arrancar: Supabase URL/keys/JWT, Anthropic key, CRON_SECRET,
   WEBHOOK_SIGNING_SECRET, `NEXT_PUBLIC_CLIENT_SLUG`. Gmail es opcional.
4. Aplicar las migraciones (`supabase/migrations/*.sql`) sobre el proyecto
   Supabase del cliente (o uno compartido, ya que las migraciones tienen
   RLS por `client_slug`).
5. `npm install && npm run dev` → http://localhost:3102
6. Reemplazar los prompts (`orchestrator.md`, `knowledge-base.md`) y la
   marca (`BrandLogo.tsx`, `brand-logo.png`).

## Cómo trabajar con prompts

- **Para cambios chicos**: editás el `.md`, `npm run eval` para verificar
  que ningún escenario rompe, y deployás.
- **Para features nuevas o flows nuevos**: sumá uno o más escenarios en
  `scripts/evals/scenarios.ts` ANTES de tocar el prompt; corré la suite;
  iterá hasta que pase. Patrón TDD para prompts.
- **Las reglas de formato son determinísticas** (`sanitize.ts`): no las
  repitas como criterios bloqueantes del evaluator (eso causaba falsos
  rechazos por alucinación del modelo pequeño).

## Cómo trabajar con la KB

- Toda afirmación del agente sobre el cliente tiene que estar en
  `knowledge-base.md`. Si no está, el agente deriva.
- Datos "reactivos" (cosas que el agente solo dice si preguntan
  puntualmente, nunca proactivo) van marcadas con la regla explícita en
  la FAQ + un bullet en `orchestrator.md` sección "Cosas que NO".
- Si la KB crece más allá de lo que entra cómodamente en contexto,
  considerá slicing determinístico por señal antes de saltar a RAG
  (caching hace que la KB completa cacheada salga más barata que chunks
  retrievados, para KBs medianas).

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript estricto
- **Tailwind CSS 3.4**, componentes propios
- **`@anthropic-ai/sdk`** (HTTP directo, sin Agent SDK)
- **`@supabase/supabase-js` + `@supabase/ssr`** (Postgres + Realtime)
- **`nodemailer`** (Gmail SMTP)
- **`zod`** (env validation), **`lucide-react`** (iconos), **`date-fns`**

## Módulos opcionales (no incluidos en el template)

- **Bot de WhatsApp (Baileys)**: existe como módulo en los clientes que
  lo usan (Quintaglia). Para sumarlo, cherry-pickeá `scripts/wa-bot/` +
  `src/app/(dashboard)/wa/` + `src/app/api/wa/` + `src/components/wa/`
  desde un cliente que lo tenga. Incluye fixes de auto-recovery en
  `loggedOut` y EBUSY sobre el mount del AUTH_DIR.
- **Sistema de Leads** (CRM-lite para flujos comerciales): existe en
  iBath y Quintaglia. Cherry-pickear de ahí si el cliente lo necesita.

## Sincronización con el template

Cuando hagas mejoras en el template, propagalas a los clientes con
cherry-pick selectivo por path (no `git merge` directo, que pisa los
prompts del cliente). Inversamente, cuando descubras una mejora de
plataforma en un cliente, traela acá.

Ver `CLAUDE.md` para el design system del panel y convenciones de UI.
