# Agente IA + GoHighLevel (WhatsApp) sin n8n

Documento técnico de arquitectura. Explica **cómo funciona el agente de IA** y
**cómo se conecta con GoHighLevel (GHL)** para atender WhatsApp, **sin usar n8n,
Make, Zapier ni el bot nativo de GHL**. Pensado para replicar el esquema en otro
proyecto.

> TL;DR: GHL se usa **solo como el caño de WhatsApp** (recibir y enviar
> mensajes). **Toda la inteligencia vive en nuestro backend** (Next.js + API de
> Claude). La conexión con GHL es: **1 webhook de entrada** (un Workflow de GHL
> que pega a una URL nuestra) + **la API de Conversations de GHL para responder**
> (con un token privado). Nada más. No hay middleware tipo n8n.

---

## 1. Filosofía / por qué sin n8n

La mayoría de la gente arma esto con n8n/Make en el medio: GHL → n8n → OpenAI →
n8n → GHL. Eso suma una pieza más que mantener, debuggear y pagar, y deja la
lógica partida entre la herramienta visual y el código.

Acá la lógica vive **entera en nuestro backend**:

- **GHL** = transporte de WhatsApp (coexistence). Recibe los mensajes del cliente
  y manda los nuestros. No piensa, no decide.
- **Nuestro backend (Next.js en Vercel)** = todo lo demás: recibir el webhook,
  guardar la conversación, correr el agente (orquestador + evaluador con la API
  de Claude), y mandar la respuesta de vuelta a GHL.
- **Supabase (Postgres)** = sistema de registro: conversaciones, mensajes, cola
  de jobs, traces del agente.

La única configuración del lado de GHL son **dos cosas**:

1. Un **Workflow** con trigger "Customer Replied" que dispara una acción
   **Webhook** (POST) hacia nuestra URL. (Entrada)
2. Un **Private Integration Token (PIT)** con permisos de Conversations y
   Contacts, que usamos para responder y para leer adjuntos. (Salida)

Eso reemplaza a n8n por completo.

---

## 2. Diagrama de flujo

```
  Cliente (WhatsApp)
        │  escribe
        ▼
  GoHighLevel  ──(Workflow: Customer Replied → Webhook POST)──►  /api/webhooks/ghl/inbound
                                                                       │
                                                  crea/halla conversación + guarda mensaje(s)
                                                  encola un job en `agent_jobs`
                                                       │
                                                  dispara el worker (after())   ──┐
                                                                                  │
  Vercel Cron (cada 1 min) ─────────────────────────────────────────────────────► /api/jobs/process
                                                                                  │  (worker)
                                                         reclama jobs pending (atómico)
                                                         aplica debounce (junta mensajes seguidos)
                                                         corre el AGENTE:
                                                            orquestador (Claude) → evaluador (Claude)
                                                            (con fallback a OpenRouter)
                                                         guarda la respuesta en `messages`
                                                         la entrega a WhatsApp  ──┐
                                                                                  │
  GoHighLevel  ◄──(POST /conversations/messages, PIT)───────────────────────────┘
        │  reenvía a WhatsApp
        ▼
  Cliente (WhatsApp)
```

Puntos clave:

- El webhook de GHL **no trae las URLs de los adjuntos** (imágenes/PDF/audio):
  esos los traemos aparte con la **Conversations API** de GHL.
- La respuesta del agente **no se genera en el webhook** (sería muy lento y se
  cortaría por timeout). El webhook solo **encola** y devuelve 200 al toque; el
  **worker** procesa después (cron + auto-trigger).

---

## 3. La conexión con GHL (lo central)

### 3.1. Modo "coexistence" de WhatsApp

GHL ofrece WhatsApp en modo **coexistence**: el número de WhatsApp del negocio
(en un celu/WhatsApp Business) se vincula a GHL, y GHL sincroniza la mensajería.
Para nosotros, GHL expone esa mensajería por su API y sus Workflows. (Si en lugar
de coexistence usás la WhatsApp Business Platform oficial vía GHL, aplica el
límite de 24h de Meta y los templates preaprobados; el código de envío es el
mismo.)

### 3.2. Entrada: Workflow "Customer Replied" → Webhook

En GHL: **Automation → Workflows → New Workflow**.

- **Trigger:** "Customer Replied", filtrado al canal **WhatsApp**.
- **Action:** "Webhook" → método **POST** → URL: `https://TU-APP/api/webhooks/ghl/inbound`.
- En el body del webhook mapeás (o dejás el payload estándar de GHL) al menos:
  `contact_id`, `first_name`, `last_name`, `full_name`, `phone`,
  `message.body` (el texto), y `location.id`.

Eso es lo que reemplaza a n8n: GHL pega directo a tu endpoint cuando entra un
mensaje. No hace falta nada más en el medio.

> Seguridad: en prod, la URL puede ir detrás del bypass de Deployment Protection
> de Vercel y/o exigir un header secreto (`GHL_WEBHOOK_SECRET` → header
> `x-ghl-secret`). Es opcional pero recomendado.

### 3.3. Salida: Conversations API con el PIT

Para responder, llamamos a la API de GHL directamente:

```
POST https://services.leadconnectorhq.com/conversations/messages
Authorization: Bearer <PIT>
Version: 2021-04-15
Content-Type: application/json

{ "type": "WhatsApp", "contactId": "<id de GHL>", "message": "<texto>" }
```

Devuelve un `messageId` (lo guardamos para deduplicar después el eco del propio
envío). Si la API responde error (ej. ventana de 24h vencida en la WhatsApp
oficial), lo capturamos y avisamos para envío manual.

### 3.4. El PIT (Private Integration Token)

En GHL: **Settings → Private Integrations → Create**. Scopes mínimos:

- **Conversations** (View + Edit / Send): leer y enviar mensajes.
- **Contacts** (View + Edit): leer el contacto (nombre/email) y **escribirlo**
  (cuando el agente captura el nombre y apellido real, lo seteamos en el
  contacto de GHL).

Guardás el token como `GHL_API_KEY` (server-side, nunca en el cliente) y el
`locationId` como `NEXT_PUBLIC_GHL_LOCATION_ID`.

### 3.5. Adjuntos (imágenes / PDF / audio)

El webhook de "Customer Replied" **no incluye las URLs de los adjuntos**. Por eso,
cuando entra un mensaje, hacemos:

1. `GET /conversations/search?locationId=...&contactId=...` → obtenemos el
   `conversationId` de GHL del contacto.
2. `GET /conversations/{conversationId}/messages` → traemos los mensajes
   recientes (con sus `attachments` = URLs públicas).
3. Descargamos cada adjunto, lo guardamos, y lo procesamos (vision para
   comprobantes/imágenes, transcripción para audio).

Esto mismo nos da, de paso, el `conversationId` de GHL para armar deep-links al
chat desde el panel.

---

## 4. Entrada en detalle (`/api/webhooks/ghl/inbound`)

Qué hace el endpoint, en orden:

1. **Valida** el payload (zod) y, si está configurado, el header secreto.
2. **Halla o crea la conversación** por el `contact_id` de GHL (lo guardamos como
   `external_id`). Guarda nombre y teléfono del contacto.
3. **Resuelve texto + adjuntos.** Trae los adjuntos recientes por la Conversations
   API (paso 3.5), deduplicando por URL para no re-procesar. Cada adjunto se
   guarda como **su propio mensaje** (con su caption). El audio se transcribe.
4. **Inserta los mensajes** del usuario en `messages`.
5. **Encola un job** en `agent_jobs` (uno por turno) para que el worker lo
   procese.
6. **Dispara el worker** de inmediato (`after(() => fetch('/api/jobs/process'))`)
   y **devuelve 200** sin esperar la respuesta del agente.

> Hay un segundo webhook opcional (`/api/webhooks/ghl/message`) para el evento
> "OutboundMessage": sirve para ingerir mensajes que un humano manda desde GHL y
> para deduplicar los ecos de nuestros propios envíos. No es imprescindible para
> el flujo del agente.

---

## 5. El worker y la cola de jobs (`/api/jobs/process`)

El agente **no corre dentro del webhook**: corre en un **worker** desacoplado.
Esto da resiliencia (reintentos, no se pierde nada si algo falla) y evita
timeouts.

- **Disparadores:** (a) **Vercel Cron cada 1 minuto** (`vercel.json` →
  `crons: [{ path: "/api/jobs/process", schedule: "* * * * *" }]`), y (b) el
  **auto-trigger** del webhook (para responder en segundos, no esperar al cron).
- **Auth:** el worker exige `CRON_SECRET` (header `x-cron-secret`) en prod.
- **Reclamo atómico:** toma hasta N jobs `pending` con un RPC de Postgres
  (`claim_agent_jobs`) que los marca `in_progress` en una transacción, para que
  dos ejecuciones concurrentes no agarren el mismo job.
- **Procesa secuencialmente** cada job: arma el turno, corre el agente, persiste
  la respuesta, la entrega a WhatsApp, y marca el job `completed`.
- **maxDuration 300s** (el agente puede tardar).

### 5.1. Debounce (acumulación de mensajes)

La gente manda varios mensajes cortos seguidos ("hola", "una consulta", "sobre el
curso"). Si respondiéramos a cada uno, sería un caos. El worker aplica un
**debounce**: espera una **ventana de silencio** (`MESSAGE_DEBOUNCE_SECONDS`,
~60s en prod) y **consolida** los mensajes seguidos del contacto en **un solo
turno**. Si llega un mensaje nuevo dentro de la ventana, re-difiere el job. Recién
cuando hay silencio, responde una vez.

---

## 6. El agente (lo que reemplaza a "la IA de n8n")

Vive en `src/lib/agent/`. El orquestador del loop es `runAgent()`.

### 6.1. Loop orquestador + evaluador

```
runAgent(turno):
  para iteración 1..MAX (AGENT_MAX_ITERATIONS, default 3):
     1) ORQUESTADOR: 1 llamada a Claude (messages.create) con:
          - system prompt = persona + procedimiento (orchestrator.md)
                           + base de conocimiento (knowledge-base.md)
                           + contexto dinámico (eventos vigentes, horario,
                             estado del contacto, pagos de la conversación)
          - history = mensajes previos del turno
          - tools = [notify_team, registrar_nombre]
        → devuelve texto (la respuesta propuesta) + 0..n tool calls
     2) Si llamó notify_team → derivar a humano y cerrar (handoff).
     3) EVALUADOR: 2da llamada a Claude que VALIDA la respuesta contra la KB
        (portón anti-alucinación). Si pasa → se envía. Si no → guarda feedback
        y reintenta (vuelve a 1).
  si se agotan las iteraciones sin respuesta válida → derivar a humano.
```

Por qué dos modelos:

- **Orquestador** (modelo "fuerte", ej. Sonnet): redacta la respuesta siguiendo
  la persona y el procedimiento.
- **Evaluador** (modelo "barato", ej. Haiku): actúa de **guardrail**. Recibe SOLO
  la KB + el bloque de datos dinámicos (no el prompt del orquestador) y decide si
  la respuesta afirma algo que NO está respaldado. Si detecta una invención,
  **bloquea** y fuerza un reintento o deriva. Esto baja muchísimo las
  alucinaciones sin meter las reglas como criterios frágiles en un solo prompt.

> Importante: todo dato dinámico que se le inyecta al orquestador (ej. eventos,
> precios) **también** se le inyecta al evaluador. Si no, el evaluador lo
> rechazaría como invención.

### 6.2. Prompts

- `orchestrator.md`: persona (quién es el agente, tono), reglas duras (nunca
  inventar; cuándo derivar), y el **procedimiento** paso a paso.
- `knowledge-base.md`: la **fuente de verdad** de lo que el agente puede afirmar
  (datos del negocio, eventos, FAQ). Si un dato no está acá, el agente no lo
  inventa: deriva.
- El system prompt final se **arma dinámicamente** (`prompt-builder.ts`) sumando
  contexto en vivo: hora/horario de atención, estado del contacto, catálogo de
  eventos vigente (que se administra desde una tabla, no hardcodeado), etc.

### 6.3. Tools (cómo el agente ejecuta acciones)

Formato **API directa de Anthropic** (no MCP). El orquestador las declara en
`tools` y, cuando el modelo emite un bloque `tool_use`, despachamos a mano:

- **`notify_team`**: deriva la conversación a un humano (con categoría + resumen).
  Marca un handoff y congela al agente.
- **`registrar_nombre`**: cuando la persona da su nombre y apellido, el agente la
  invoca → actualizamos nuestro registro **y seteamos el nombre en el contacto de
  GHL** vía la Contacts API. (Ejemplo de cómo el agente escribe de vuelta en GHL.)

Agregar una tool nueva es: definir su schema + manejar el `tool_use` en el
orquestador. Sin n8n, sin nodos.

### 6.4. Fallback de proveedor (resiliencia)

`createConversationMessage()` (en `llm-call.ts`) hace una **cascada** ante caídas:

1. **Anthropic directo** (camino normal).
2. **Claude vía OpenRouter** (si la API directa de Anthropic falla con 5xx/429).
3. **GPT vía OpenRouter** como último recurso.

Traduce el formato Anthropic ↔ OpenAI de forma transparente. Es **inerte** si no
hay `OPENROUTER_API_KEY` (se comporta como solo-Anthropic). Solo cae al fallback
ante errores de servidor/red, no ante 4xx de request.

### 6.5. Salida: entrega a WhatsApp

La respuesta del agente se **persiste primero** en `messages` (sistema de
registro) y después se **entrega** a WhatsApp vía GHL (`ghlSendWhatsApp`, sección
3.3). El agente puede partir la respuesta en varias burbujas (separadas por una
línea con `---`); cada burbuja se manda por separado.

- **Allowlist (`GHL_SEND_ALLOWLIST`)**: fail-closed. Solo se envía a contactos
  habilitados (en piloto, una lista; en prod, `*` = todos). Evita mandar mensajes
  reales sin querer durante pruebas.
- **Outbox + reintentos**: si el envío a GHL falla, se encola en `wa_outbox` y el
  cron reintenta.

---

## 7. Switch humano / IA

Cada conversación tiene un **modo** (IA / HUMANO). Si un asesor toma la
conversación (por un tag en GHL o desde el panel), el modo pasa a HUMANO y el
agente **se calla** (el worker descarta el turno). Cuando se libera, vuelve a
responder. Así un humano puede intervenir sin pelearse con el bot.

---

## 8. Configuración / variables de entorno

Server-side (nunca exponer):

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | API de Claude (orquestador, evaluador, vision). |
| `ANTHROPIC_MODEL_ORCHESTRATOR` | Modelo del orquestador (default `claude-sonnet-4-6`). |
| `ANTHROPIC_MODEL_EVALUATOR` | Modelo del evaluador (default `claude-haiku-4-5`). |
| `ANTHROPIC_MODEL_VISION` | Modelo de lectura de imágenes/comprobantes. |
| `AGENT_MAX_ITERATIONS` | Reintentos del loop evaluador (default 3). |
| `AGENT_TIMEOUT_MS` | Timeout por llamada del agente (default 60000). |
| `MESSAGE_DEBOUNCE_SECONDS` | Ventana de silencio del debounce (~60 en prod). |
| `CRON_SECRET` | Protege el worker `/api/jobs/process`. |
| `GHL_API_KEY` | El **PIT** de GHL (enviar mensajes, leer/escribir contacto, traer adjuntos). |
| `GHL_WEBHOOK_SECRET` | (Opcional) valida el webhook de entrada. |
| `GHL_SEND_ALLOWLIST` | Contactos habilitados para envío (fail-closed; `*` = prod). |
| `OPENROUTER_API_KEY` | (Opcional) habilita el fallback de proveedor. |
| `OPENROUTER_MODEL_PRIMARY` / `_FALLBACK` | Slugs del fallback (Claude / GPT vía OpenRouter). |

Cliente (público):

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_GHL_LOCATION_ID` | locationId de GHL (deep-links y la Conversations API). |

Más: credenciales de Supabase (URL + service role key server-side) y, si vas a
guardar adjuntos, un bucket de storage.

---

## 9. Endpoints de la API de GHL que usamos

Base: `https://services.leadconnectorhq.com`

| Método / Path | Header `Version` | Para qué |
|---|---|---|
| `POST /conversations/messages` | `2021-04-15` | Enviar mensaje de WhatsApp. |
| `GET /conversations/search?locationId&contactId` | `2021-04-15` | Hallar el `conversationId` del contacto. |
| `GET /conversations/{id}/messages` | `2021-04-15` | Traer mensajes recientes (con adjuntos). |
| `GET /contacts/{id}` | `2021-07-28` | Leer el contacto (nombre, email). |
| `PUT /contacts/{id}` | `2021-07-28` | Escribir el contacto (nombre/apellido/email). |

Todos con `Authorization: Bearer <PIT>`.

---

## 10. Checklist para replicarlo en otro proyecto

1. **Backend**: una app (acá Next.js en Vercel) con:
   - `POST /api/webhooks/ghl/inbound` (recibe y encola).
   - `POST /api/jobs/process` (worker: debounce + agente + envío), con cron cada
     minuto.
2. **DB** (Postgres/Supabase): tablas `conversations`, `messages`, `agent_jobs`
   (+ traces si querés observabilidad). Un RPC de reclamo atómico de jobs.
3. **GHL**:
   - Crear el **PIT** con scopes Conversations + Contacts.
   - Crear el **Workflow** "Customer Replied" (WhatsApp) → Webhook POST a tu URL.
4. **Agente** (`src/lib/agent/`): orquestador + evaluador con la API de Claude,
   tus prompts (persona + KB), y las tools que necesites.
5. **Envío**: cliente de la Conversations API de GHL (`ghlSendWhatsApp`) + una
   allowlist fail-closed para pruebas.
6. (Opcional) **Fallback** de proveedor con OpenRouter, **transcripción** de
   audio, **vision** para imágenes, y el **deep-link** al chat de GHL desde tu
   panel.

Con eso tenés el mismo esquema: GHL como caño de WhatsApp, toda la IA y la lógica
en tu backend, **sin n8n**.
