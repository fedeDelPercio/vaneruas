# Contexto del proyecto · atp-vanesaruas

Documento para agentes de código (Claude, Codex, Grok, etc.) que trabajan en
este repo. Leelo entero antes de tocar el agente, la base de datos o el panel.
Para reglas visuales del panel, ver `design-system.md` y `CLAUDE.md`.

Actualizado al 17/11/2026.

---

## 1. Qué es

Panel + agente de WhatsApp para **Vanesa Rúas Formación Profesional**, una
escuela de especializaciones para profesionales de la estética (cosmetólogas,
cosmiatras, dermatocosmiatras). Vende masterclasses online y un congreso
presencial.

- **Valentina** es la asistente IA que atiende el WhatsApp del cliente. Responde
  consultas, comparte links de inscripción, recibe comprobantes de pago y deriva
  al equipo lo que no sabe.
- **El panel** (Next.js) es donde el equipo del cliente valida comprobantes, da
  acceso a los cursos, atiende derivaciones y mira métricas.
- **WhatsApp entra y sale por GoHighLevel (GHL)**, en modo coexistence. GHL es
  solo el caño: toda la lógica vive en este backend.
- El repo nació del template **ATP** (Agentic Testing Panel). El `README.md`
  describe el template, no este cliente: no lo tomes como fuente de verdad.
- Dueño técnico: Federico. El cliente es Vanesa Rúas y su equipo.

---

## 2. Reglas duras (no negociables)

1. **Antes de pushear a `main` pedí confirmación explícita.** Vercel despliega
   `main` a producción y el cliente lo ve. Excepción: si la tarea ya decía
   "deployá" o "probá en prod".
2. **Nunca imprimas ni commitees secretos.** `.env.local` está en
   `.gitignore`. Para scripts, pasá las variables leyéndolas del archivo
   (ver sección 11), nunca las copies en código ni en logs.
3. **La base de Supabase es COMPARTIDA con otros clientes** (iBath, Scaglia,
   Quintaglia, stag). El proyecto es `cwogvvjsbjksdnztrnmv`.
   - El cliente del panel (`getSupabaseServerClient`) usa un JWT con claim
     `client_slug` y RLS lo aísla solo. Ahí no hace falta filtrar.
   - **Con service role (scripts) RLS no aplica: filtrá SIEMPRE por
     `client_slug = 'vanesaruas'`.** Ya pasó dos veces que un script mezcló
     conversaciones de otros clientes en un análisis.
   - No modifiques datos de otros tenants. Un cambio de esquema afecta a todos.
4. **Datos personales:** los informes de conversaciones tienen nombres,
   teléfonos y correos de clientas reales. Van en `informes/` (gitignoreado) o
   solo en el chat. Nunca al repo ni a un sitio público.
5. **Merge `main → client/*`:** NO `git merge origin/main` directo, borra los
   prompts del cliente. Usar checkout selectivo por path.
6. **El alta en Tiendup es automática solo por el camino ya acordado.** Desde
   el 17/11/2026, por pedido explícito de Federico, un pago de masterclass
   validado, con el título OK y correo válido se da de alta solo
   (`src/lib/tiendup/auto-enroll.ts`, flag `TIENDUP_AUTO_ENROLL`, prendido por
   defecto). Usa la misma lógica que el botón y nunca fuerza: si la persona
   figura con otro correo, falta el correo o Tiendup falla, deja una
   notificación al equipo. No sumes otras inscripciones automáticas (otros
   cursos, forzar con otro correo) sin que Federico lo pida.
7. **Excepción de estilo de este cliente:** Valentina **sí** usa emojis con
   moderación y **sí** se presenta como "la asistente IA de Vanesa Rúas
   Formación Profesional". No los "corrijas" como si fueran bugs. El resto de
   las reglas de formato sigue (sección 5).
8. **Nunca dar datos bancarios** (CBU, alias, titular). Valentina inventó un CBU
   una vez; hay una regla dura en la base de conocimiento. Si los piden, deriva.

---

## 3. Arquitectura y flujo de un mensaje

```
Clienta escribe por WhatsApp
  -> GHL (workflow "Customer Replied")
  -> POST /api/webhooks/ghl/inbound
       guarda message role="user", crea agent_job con process_after = ahora + debounce
       si hay adjunto, lo trae por la API de Conversations de GHL (el webhook no trae la URL)
  -> cron cada minuto: /api/jobs/process  (también se dispara solo desde el inbound)
       |
       |-- ¿el mensaje trae imagen/PDF?  -> handleAttachmentIntake (src/lib/titles/handle.ts)
       |      clasifica con vision: comprobante / título / otro
       |      comprobante -> payment_validations (+ gate de título si no es clienta)
       |      título válido -> professional_titles, marca clienta, libera comprobantes retenidos
       |      captura el correo de los últimos mensajes y CORTA el job (no corre el agente)
       |
       |-- si no -> runAgent (src/lib/agent/run.ts)
              consolida los mensajes del turno (debounce)
              orquestador redacta  ->  evaluator valida  ->  hasta AGENT_MAX_ITERATIONS
              si el evaluator rechaza todas las veces -> deriva "fuera_de_conocimiento"
              sanitizeStyle (formato determinístico)
              envía por GHL, partiendo en burbujas por las líneas "---"
  -> notify_team (si derivó) -> agent_notifications -> email + panel
```

**Mensajes del equipo:** la app de GHL no está instalada (el install quedó
trabado), así que el evento `OutboundMessage` nunca llega. Un cron cada 5
minutos (`/api/jobs/import-human`, `src/lib/providers/ghl-human.ts`) trae de la
API de GHL lo que escribió una persona y lo guarda como `role="human"`.
Cobertura desde el 31/08/2026. Un saliente es "nuestro" si su id de GHL está en
`messages.external_id` o su texto coincide con algo que mandamos; el resto es
del equipo. La cercanía temporal NO sirve como señal (el equipo contesta a
segundos del bot).

**Modo IA / Humano:** `conversations.mode`. En modo `HUMAN` el agente no
responde, pero los comprobantes igual se registran. Se cambia por tres caminos,
que tienen que quedar coherentes:

- **Tag de GHL** (`GHL_PAUSE_TAG`, webhook `/api/webhooks/ghl/mode`): el equipo
  pone o saca el tag en GHL y el webhook recalcula el modo de ese contacto.
- **Chat del panel** (`POST /api/wa/mode/[id]`, botón "Tomar conversación" /
  "Devolver a Valentina"): cambia el modo Y pone o saca el mismo tag en GHL
  (`ghlSetPauseTag`, nombre exacto en `GHL_PAUSE_TAG_EXACT`). Enviar un mensaje
  desde el panel también asegura el tag. Si GHL no lo acepta, el chat lo avisa
  y ofrece reintentar.
- **Interruptor general** (`/api/agent-mode`, header): pone el modo en masa, sin
  tocar tags. Al reactivar la IA respeta a quien tiene el tag. Por eso importa
  que lo tomado desde el panel tenga tag: sin él volvería a Valentina.

El worker lee el modo dos veces: antes de correr el agente y otra vez después
de redactar. Si en el medio el equipo tomó la conversación, la respuesta se
descarta (no se le contesta encima a una persona).

**Mensajes del equipo desde el panel:** `POST /api/wa/messages/[id]` envía por
GHL y guarda `role="human"` con `external_id` (id de GHL) y `delivered_at`.
Exige modo `HUMAN` y respeta `GHL_SEND_ALLOWLIST`. El importador de mensajes
del equipo reconoce esos envíos por el id y no los duplica; su marca de agua
solo mira mensajes sin `delivered_at` (los importados).

**Debounce:** `MESSAGE_DEBOUNCE_SECONDS` (~60 s en prod). Toda respuesta de
WhatsApp espera ese silencio antes de contestar. Es una decisión aceptada.

**Envío restringido:** `GHL_SEND_ALLOWLIST` decide a quién se le manda de
verdad (`*` = producción). Si un envío no sale, mirá eso primero.

**Ventana de 24 h de Meta:** pasadas 24 h del último mensaje de la clienta, GHL
rebota los mensajes libres. En Aprobaciones aparece como "No se avisó al
cliente". No es un bug del agente.

---

## 4. El agente

| Archivo | Qué hace |
|---|---|
| `src/lib/agent/run.ts` | Loop orquestador + evaluator, fallback de derivación, `ensureTeamHandoffAssurance` |
| `src/lib/agent/orchestrator.ts` | Llama al modelo que redacta |
| `src/lib/agent/evaluator.ts` | Valida la respuesta antes de enviarla |
| `src/lib/agent/prompt-builder.ts` | Arma el system prompt del orquestador |
| `src/lib/agent/prompts/orchestrator.md` | Instrucciones y procedimiento de Valentina |
| `src/lib/agent/prompts/evaluator.md` | Criterios del evaluator |
| `src/lib/agent/prompts/knowledge-base.md` | Base de conocimiento fija (requiere deploy) |
| `src/lib/agent/events-kb.ts` | Bloque "EVENTOS VIGENTES" desde la tabla `events` (en vivo) |
| `src/lib/agent/plazos.ts` | Plazos con fecha fija resueltos en código |
| `src/lib/agent/business-hours.ts` | Contexto de fecha y horario que ve el modelo |
| `src/lib/agent/sanitize.ts` | Limpieza de formato después del evaluator |
| `src/lib/agent/llm-call.ts`, `llm-translate.ts` | Proveedor, fallback a OpenRouter, traducción Anthropic ↔ OpenAI |
| `src/lib/agent/tools/notify_team.ts` | Derivación al equipo |
| `src/lib/agent/tools/registrar_nombre.ts` | Guarda nombre y apellido (también en GHL) |

### Dónde vive el conocimiento

- **Ficha del evento (`events.details`)**: se lee en vivo en cada respuesta.
  Es el canal para corregir sin deploy (precios, fechas, respuestas modelo de
  una masterclass). Solo entran eventos `status = 'activo'` con `announce_at`
  vencido o nulo. Se edita desde el panel `/events` o por script.
- **`knowledge-base.md`**: lo estable o lo que debe sobrevivir a un evento (por
  ejemplo el calendario "Planificá tu verano", que dura hasta marzo 2027).
  Requiere commit + deploy.
- **`orchestrator.md`**: cómo se comporta, no qué sabe.

### Reglas que tenés que respetar al tocar el agente

- **El evaluator NO recibe el prompt del orquestador.** Recibe `evaluator.md` +
  `knowledge-base.md` + el bloque de eventos. Cualquier afirmación nueva que
  Valentina deba decir (un link, una política, un dato) tiene que estar en la
  base o en la ficha. Si solo está en `orchestrator.md`, el evaluator la toma
  como inventada, la rechaza, y tres rechazos seguidos terminan en una
  derivación genérica al equipo.
- **Todo dato dinámico que se inyecte al orquestador va también al evaluator.**
  Si no, se derivan respuestas correctas de forma intermitente.
- **El modelo compara mal fechas.** Si una respuesta depende de si un plazo ya
  pasó, resolvelo en código (`plazos.ts`, mismo criterio que `followUpTiming`)
  y pasale el estado ya calculado. Ejemplo real: el 26/11 decía "todavía estás a
  tiempo, cierran este miércoles 25".
- **Al derivar, el mensaje SIEMPRE avisa que el equipo responde "a la
  brevedad".** Lo garantiza `ensureTeamHandoffAssurance` en código. No lo
  rompas. Nunca prometer día u hora de contacto.
- **La venta es autogestionada:** el interés de compra NO deriva. Valentina da
  precio, link y recibe el comprobante. Si aparece una derivación por venta, es
  un bug.
- **Un "gracias" o un saludo no deriva.** Hay regla en el orquestador y en el
  evaluator.
- **Las líneas `---` separan burbujas de WhatsApp.** El evaluator las ve en
  crudo; su prompt ya sabe que no son un error.
- **Categorías válidas de `notify_team`:** `fuera_de_conocimiento`,
  `escalado_manual`, `reclamo_certificado`. Los comprobantes generan
  `validacion_pago` por otro camino. La base compartida tiene un CHECK sobre
  `agent_notifications.category` que no está en ninguna migración: una
  categoría nueva rompe el insert y tapa el email al equipo. Si sumás una,
  ampliá el CHECK con una migración.

### Modelos y costos

- Orquestador y evaluator en Sonnet (`ANTHROPIC_MODEL_*`). Verificá en Vercel
  que `ANTHROPIC_MODEL_EVALUATOR` no haya quedado en Haiku: el default del
  código es Sonnet y Haiku rechazaba respuestas correctas.
- `LLM_PRIMARY_PROVIDER=openrouter` manda la conversación por OpenRouter
  (se usó cuando Anthropic no dejaba cargar crédito). Hay fallback automático
  solo ante 5xx, 429 y timeouts.
- **El OCR de comprobantes y títulos va directo a Anthropic, sin fallback.** Si
  falla, el comprobante queda sin monto y el equipo valida a mano.
- **Prompt caching es por prefijo.** Lo estable (la base) va primero y con
  breakpoint `cache_control`. El breakpoint tiene que sobrevivir la traducción
  a formato OpenAI (`llm-translate.ts`). Con el orden invertido el cache no
  pegaba nunca.
- `agent_trace_steps` guarda tokens, lectura/escritura de cache y `cost_usd`
  (lo que cobra OpenRouter; null si fue Anthropic directo).

---

## 5. Estilo de Valentina

- Español rioplatense, voseo, cálido, mensajes cortos. A las interesadas,
  "colegas" o "profesionales"; a quienes ellas atienden, "pacientes".
- Sin `**negrita**`, sin `¿` ni `¡` de apertura, sin guión largo, sin punto
  final. Lo limpia `sanitize.ts` después del evaluator, así que el evaluator no
  rechaza por formato.
- Emojis con moderación, y se presenta como asistente IA (excepción del
  cliente, ver sección 2).
- Si la persona cree que habla con Vanesa ("hola Vane"), aclara que es
  Valentina aunque la charla venga empezada.
- No usar el nombre "Nueva Piel" (marca vieja).
- Respuesta larga: hasta 3 burbujas separadas por una línea con `---`.

---

## 6. Base de datos

Proyecto Supabase compartido, schema `public`, migraciones en
`supabase/migrations/` (001 a 032). No hay MCP de Supabase siempre disponible:
para leer o escribir datos se usan scripts con service role.

| Tabla | Para qué |
|---|---|
| `conversations` | Una por contacto. `external_id` = contactId de GHL, `source` (`whatsapp`/`test`), `mode` (`AI`/`HUMAN`), `contact_email`, `is_existing_customer`, `agendada`, `ghl_conversation_id`, `display_name` |
| `messages` | `role`: `user` (clienta), `assistant` (Valentina o el panel), `human` (equipo, importado de GHL), `system` (carteles). `external_id` = id de GHL. **Tiene `client_slug` NOT NULL**: con service role hay que setearlo al insertar |
| `agent_jobs` | Cola del worker, con `process_after` para el debounce |
| `agent_traces` / `agent_trace_steps` | Una corrida del agente y sus pasos (tokens, cache, costo) |
| `agent_notifications` | Derivaciones al equipo (`category`, `reason`, `summary`, `resolved_at`/`resolved_by`). Las de sistema de Tiendup van como `escalado_manual` con `reason` que empieza con `tiendup_` |
| `payment_validations` | Comprobantes: monto leído por OCR, `event_slug`, `status` (`pending`/`validated`/`rejected`), `awaiting_title`, `course_access_granted_at`, `delivery_failed` |
| `professional_titles` | Títulos enviados para el gate |
| `events` | Masterclasses y congreso: precios, fechas, `details` (ficha en vivo), `status` (`borrador`/`activo`/`archivado`) |
| `profiles` | Usuarios del panel con rol `dev` / `client` / `asesor` |

Roles y rutas del panel: `ROLE_ACCESS` en `src/lib/profile.ts`.

---

## 7. Módulos del panel

| Ruta | Qué es |
|---|---|
| `/wa` | Bandeja de WhatsApp: lista paginada con buscador y filtros (Todas, Intervención, Con el equipo), chat visto desde el equipo (tomar la conversación y escribirle a la clienta) y ficha del contacto con sus eventos, donde se ven y se aprueban o rechazan comprobantes y títulos. Componentes en `src/components/wa/`, rutas en `src/app/api/wa/` |
| `/payments` (Aprobaciones) | Validar comprobantes. Pestaña **"Falta acceso"** = worklist de masterclass validadas sin acceso a Tiendup (incluye a quien no dejó correo, con aviso) |
| `/interventions` (Derivaciones) | Lo que Valentina pasó al equipo (excluye comprobantes y certificados) |
| `/certificados` | Reclamos de certificados (`reclamo_certificado`) |
| `/agendar` | Contactas que mandaron comprobante y faltan agendar en GHL / grupos |
| `/events` | Alta y edición de eventos (la ficha que lee el agente en vivo) |
| `/metrics` | Métricas (ver sección 9) |
| `/conversations`, `/feedback`, `/webhooks` | Solo `dev`: banco de pruebas, feedback, webhooks salientes |

**Botón de feedback** (header, `src/components/feedback/`): Mejora o Bug,
texto escrito o grabado (el audio pasa por `/api/transcribe` y se escribe tal
cual, sin que una IA lo reescriba) y capturas pegadas con Ctrl+V, arrastradas o
adjuntas (el navegador las achica antes: Vercel corta los envíos de más de
4,5 MB). `POST /api/tickets` lo manda a AI ScaleMap (`src/lib/aiscalemap.ts`,
`/api/intake/tickets` del repo `ai-scalemap`), que crea el ticket en el
proyecto de Vanesa Rúas. La clave va en `integration_tokens` (provider
`aiscalemap`, `client_slug` `vanesaruas`) y su hash en `TICKET_INTAKE_KEYS` de
AI ScaleMap. Cerrar el cuadro no borra el borrador.

Todas las bandejas tienen buscador por nombre o teléfono
(`src/lib/search.ts`, sin distinguir tildes y aceptando el teléfono como se
dicta: "011 15 ..."). La búsqueda la resuelve el servidor (`?q=`) sobre todo el
historial; la lista muestra hasta 300 filas y el contador dice "300 de N".
"Ver chat" abre la conversación en `/wa?id=`.

La ficha del contacto (`GET /api/wa/contact/[id]`) une los comprobantes con su
evento por `titleKeyword` de `event-match.ts` (la tabla `events` no guarda el
slug): al sumar una masterclass hay que cargar esa palabra.

Aprobaciones, detalles que importan:

- **Aprobar** manda por WhatsApp: "Buenísimo, tu pago quedó verificado ✅ En
  breve te enviamos el acceso a tu correo, cualquier cosa quedamos en contacto
  🙌🏻".
- **Rechazar pide confirmación** (antes era un click y se rechazaron pagos
  buenos por error). **Descartar** (la cruz) es para imágenes que no eran un
  comprobante; deja `validation_note` con `DISMISS_NOTE`
  (`src/lib/payments/dismiss.ts`).
- **Alta automática en Tiendup** al validar (o al validarse el título, o al
  llegar el correo): misma lógica que el botón, en modo conservador (exige
  correo con formato válido y el listado de inscriptos completo, nunca
  fuerza). Lo que no puede resolver abre una notificación `escalado_manual`
  ("Alta en Tiendup pendiente: motivo") que se resuelve sola cuando el alta
  sale bien.
- **"Dar acceso al curso"** (respaldo manual, `grantCourseAccess` en
  `src/lib/tiendup/grant.ts`) inscribe en Tiendup por correo. Antes chequea el
  listado real de inscriptos por correo y por nombre; si la persona figura con
  otro correo, avisa y no inscribe (inscribir con un correo malo crea un
  cliente fantasma y la persona real queda sin acceso). "Ya tiene acceso" solo
  marca, sin tocar Tiendup ni avisar.
- **Cuando el acceso queda dado** (automático o botón) se manda por WhatsApp
  `TIENDUP_ACCESS_MESSAGE` (`src/lib/tiendup/messages.ts`), una vez por curso.
  Si no sale (ventana de 24 h), queda `delivery_failed` en el comprobante y una
  notificación al equipo.
- Validar, rechazar o descartar un comprobante resuelve las notificaciones
  `validacion_pago` de la conversación cuando ya no le quedan pendientes.

---

## 8. Negocio

### Eventos

| Evento | Estado | Datos |
|---|---|---|
| **Masterclass Peelings de Verano Masterizado** | Venta activa | Sábado 28/11/2026, 16 a 21 hs, Zoom. Cierre de inscripción miércoles 25/11 21 hs. Transferencia $110.000 · tarjeta (Mercado Pago) $150.000 en 3 cuotas · exterior USD 90 por PayPal. Grabación 20 días. Zoom de consultas viernes 4/12 19 hs. Tiendup curso `554178` |
| Calendario "Planificá tu verano" | Regalo, nov 2026 a mar 2027 | Noviembre libre; diciembre a marzo se desbloquean con un código que se da en vivo en la clase del 28/11. Nunca dar ni inventar el código |
| Masterclass Higiene Facial + Dermaplaning | Dictada 1/8, grabación vencida 21/8 | Tiendup curso `519060`, en borrador. Fuera de la worklist de accesos |
| Skin Intellectuals Congress | Realizado 12 y 13/09/2026 | Se pagaba seña + saldo el día del evento, nunca el total. Hablar de él en pasado |

El documento oficial de Peelings está en la raíz:
`CONTEXTO PARA ASISTENTE DE WHATSAPP - PEELINGS DE VERANO 2026.md`. Lo que dice
ahí (incluido "Masterizado" y la "falla intermitente" de Tiendup) es correcto.

### Pagos y acceso

- Solo quien paga por **transferencia** manda comprobante. Tarjeta y PayPal se
  inscriben solos en Tiendup.
- El comprobante se asigna a un evento **por monto exacto**
  (`src/lib/payments/event-match.ts`): $267.000 Congreso, $105.000 Higiene
  Facial, $110.000 Peelings. Si el OCR no lee el monto, cae a
  `DEFAULT_COMPROBANTE_EVENT_SLUG`, que **tiene que apuntar a la venta abierta
  del momento** (hoy Peelings).
- **Gate de título:** una contacta no registrada que manda comprobante tiene
  que acreditar título del rubro (validado por IA) antes de que el pago llegue
  al equipo. Se saltea si GHL ya la tiene registrada.
- El correo para dar acceso se captura de la conversación y se valida el
  formato antes de guardarlo (`src/lib/contact-email.ts`). Si llega en un
  mensaje y el adjunto en el siguiente, igual se rescata (busca en los últimos
  15 mensajes cuando la conversación no tiene correo). Si llega un comprobante
  y no hay correo, Valentina lo pide (`EMAIL_REQUEST_MESSAGE`, burbuja aparte).
- Textos fijos del flujo de comprobante en `src/lib/payments/messages.ts`. Si
  cambiás uno, dejá el viejo en `TEXTOS_DE_PLANTILLA` de `ghl-human.ts` para
  que el importador lo siga reconociendo como nuestro.
- El link del grupo de WhatsApp llega en el correo de confirmación de Tiendup.
  Cada clase tiene grupo nuevo. Con WhatsApp Business: tres puntitos, "abrir en
  otra pestaña". El link del Zoom se manda el día de la clase por el grupo.
- Destinatario esperado de las transferencias: cuenta de Vanesa Rúas (CUIT
  hardcodeado en `src/lib/payments/recipient.ts`); si no coincide, la tarjeta
  muestra un aviso.

### Integraciones

- **GHL:** PIT en `GHL_API_KEY`, base `https://services.leadconnectorhq.com`,
  header `Version: 2021-04-15` (contactos usa `2021-07-28`). Location en
  `NEXT_PUBLIC_GHL_LOCATION_ID`. El deep-link a un thread de GHL no es confiable:
  el panel abre la **ficha del contacto**. La paginación de mensajes puede
  repetir el último id: deduplicá.
- **Tiendup:** `https://vanesaruas.public-api.tiendup.com`, header `x-api-key`
  (no Bearer). `GET /learning/courses` lista cursos;
  `POST /learning/courses/{id}/enroll` inscribe (idempotente);
  `GET /learning/courses/{id}/enrolled?limit=100&page=N` lista inscriptos. No
  hay búsqueda por correo. Mapeo evento → curso en
  `src/lib/tiendup/client.ts`.
- **OpenRouter:** fallback y switch del proveedor de conversación.
- **Vercel:** proyecto `vaneruas`, dominio detrás de Vercel Authentication (no
  hay endpoint de health público). Crons en `vercel.json`. Los webhooks de GHL
  pasan con el header `x-vercel-protection-bypass`.

---

## 9. Métricas (cómo leerlas)

- **"Conversaciones que resolvió la IA sola"** = sin derivación Y sin que nadie
  del equipo escriba. Es el indicador de autonomía. Antes se contaba solo la
  derivación y daba 76% cuando el real era ~32%: el equipo entra seguido a
  conversaciones que el agente nunca derivó.
- **"Mensajes escritos por la IA"** = proporción de salientes. Mide volumen de
  trabajo, no autonomía. Son números distintos a propósito.
- Antes del 31/08/2026 no hay registro de los mensajes del equipo: esos
  períodos salen como "sin datos" o con aviso de que el número queda alto.
- El donut de comprobantes confirmados excluye los **descartados** (imágenes
  que no eran comprobantes: nota de descarte o sin monto leído).

---

## 10. Trampas conocidas

- **PostgREST devuelve como máximo 1000 filas por request.** Toda query que
  traiga filas (no un `count` con `head: true`) tiene que paginar con
  `.range()` y **`.order()`**: sin orden, la paginación saltea filas en
  silencio. Esto ya hundió la métrica de contención y un análisis de correos.
- **Nunca pasar cientos de ids en un `.in(...)`.** La lista viaja en la URL;
  pasada cierta longitud el pedido falla ("fetch failed") y, como casi ninguna
  ruta miraba ese error, el síntoma era silencioso: tarjetas sin nombre ni
  teléfono en Aprobaciones, Agendar vacío, badges en 0. Partir en tandas de
  100 (o 50 si además se piden mensajes), o traer las dos listas paginadas
  (`fetchAllRows` en `src/lib/supabase/paginate.ts`) y cruzarlas en memoria.
- **Un tope fijo con orden ascendente descarta lo más nuevo.** Pasó en
  Aprobaciones y en Derivaciones. Las colas de pendientes van de más viejo a
  más nuevo; los historiales, al revés.
- **`conversations.updated_at` ordena la lista del chat.** No lo toques en
  actualizaciones masivas ni al cambiar el modo. Quedaron unas 600
  conversaciones con esa fecha pisada por actualizaciones viejas (6/8 y
  13/10): por eso, bien abajo en la lista, las horas no van en orden.
- **Archivos con CRLF.** Varios `.ts` del repo tienen fin de línea Windows. Los
  reemplazos multilínea por script fallan sin avisar; editá con una
  herramienta que respete el formato y verificá el diff.
- **Los scripts no pueden importar módulos con `server-only`** (por ejemplo el
  barrel `src/lib/agent/tools/index.ts` o `src/lib/supabase/server.ts`).
  Importá el archivo puntual, o inyectá el cliente de Supabase como parámetro.
- **`tsx` compila a CommonJS:** sin top-level await, envolvé en `main()`.
- **Los scripts tienen que vivir dentro de `scripts/`** para resolver
  `node_modules`.
- **`npm run eval` apunta a `scripts/evals/run.ts`, que no existe.** Los evals
  vivos son `scripts/evals-agente.ts` y `scripts/evals-calendario.ts`.
- **El `README.md` es del template** y menciona modelos y features viejos.
- **El mensaje que guardamos puede no ser el que salió:** durante un deploy
  conviven dos versiones de un mismo texto de plantilla. Por eso el importador
  de mensajes del equipo compara contra todo lo que mandamos, no solo contra la
  conversación.
- **La documentación del cliente a veces llega con la codificación rota**
  (tildes y emojis como caracteres chinos: "Planific谩" = "Planificá"). Se
  repara con `texto.encode("gbk").decode("utf-8")` en Python. Lo que va a
  Valentina tiene que quedar en UTF-8 limpio.

---

## 11. Tareas comunes

### Correr un script con las credenciales locales

```bash
NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2) \
SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-) \
  npx tsx scripts/<script>.ts
```

Sumá `OPENROUTER_API_KEY`, `GHL_API_KEY`, `NEXT_PUBLIC_GHL_LOCATION_ID`,
`TIENDUP_API_KEY` o `NEXT_PUBLIC_CLIENT_SLUG` igual, según lo que use el script.

### Cambiar lo que sabe Valentina

1. Decidí dónde va: si es de un evento activo, a su ficha (`events.details`,
   sin deploy); si tiene que sobrevivir al evento, a `knowledge-base.md`.
2. Escribí las respuestas modelo en el tono de la sección 5.
3. Si depende de una fecha, sumá el plazo a `plazos.ts`.
4. Probalo con los evals: orquestador real + evaluator real, como
   `scripts/evals-calendario.ts`. Listo cuando el evaluator aprueba todos los
   casos donde Valentina no tiene que derivar.
5. Si tocaste archivos, commit y confirmá antes de pushear.

### Sumar una masterclass nueva

1. Cargala en `/events` con su ficha y ponela `activo`.
2. Agregá su monto por transferencia a `event-match.ts`, con su
   `titleKeyword` (una palabra del título cargado en `/events`), y movés
   `DEFAULT_COMPROBANTE_EVENT_SLUG` a la nueva venta.
3. Mapeá su curso de Tiendup en `src/lib/tiendup/client.ts` (el id sale de
   `GET /learning/courses`).
4. Sumá su cierre de inscripción y su fecha a `plazos.ts`.
5. Cuando termine, marcá la anterior con `accesoVigente: false` en
   `event-match.ts` para que salga de "Falta acceso", y archivá o desactivá su
   evento.

### Scripts útiles

| Script | Para qué |
|---|---|
| `scripts/evals-calendario.ts` | Evals de punta a punta (orquestador + evaluator), con fecha simulada |
| `scripts/evals-agente.ts` | Evals del orquestador con la ficha en vivo |
| `scripts/split-ia-vs-equipo.ts` | Reparto real IA / equipo leyendo GHL |
| `scripts/import-mensajes-equipo.ts` | Backfill de mensajes del equipo desde GHL |
| `scripts/tiendup-reconciliar-accesos.ts` | Marca como "acceso dado" a quien ya está en Tiendup (requiere `--apply`) |
| `scripts/openrouter-cost-report.ts` | Costo real por período |
| `scripts/test-*.ts` | Tests puntuales (debounce, traducción LLM, match de destinatario, etc.) |

Validá siempre con `npx tsc --noEmit` y `npx next build` antes de commitear.

---

## 12. Estado y pendientes (16/11/2026)

- **Preguntas abiertas al equipo del cliente:** si el alias/CBU se puede dar
  por WhatsApp; qué hacer con quien está fuera de Argentina sin PayPal; el
  checkout de Tiendup que cobraba $150.000 en la opción de transferencia; si el
  código del calendario aparece en la grabación de la clase; qué opción tiene
  quien no hizo la masterclass y quiere desbloquear el calendario después del
  25/11.
- **QA del chat (16 y 17/11):** plan y hallazgos en `qa/`. Quedó sin probar
  de punta a punta el envío real de un mensaje del equipo (el QA corrió en solo
  lectura contra producción). Pendientes anotados ahí: orden de la lista por
  `updated_at` pisado, quién del equipo envió cada mensaje (falta columna), y
  la pestaña "Todos" de Aprobaciones, que pinta todas las tarjetas de una.
- **El 44% de las conversaciones las toma el equipo sin que el agente derive.**
  Falta clasificar cuánto es por respuestas flojas del agente y cuánto por
  costumbre del equipo.
- **Template de Meta `pago_verificado_mail`:** pendiente de aprobación, para
  avisar el pago cuando venció la ventana de 24 h.
- **Limpieza histórica sin correr:**
  `supabase/cleanup/2026-11-17-resolver-notificaciones-pago.sql` resuelve las
  ~685 `validacion_pago` abiertas de conversaciones sin pagos pendientes.
- La migración `031_messages_external_id_unique.sql` (índice único) no se pudo
  aplicar sin acceso de escritura al esquema; el importador deduplica en
  código mientras tanto. Verificá si ya está aplicada antes de asumirlo.

---

## 13. Otros documentos

- `docs/DECISIONES.md`: por qué se eligió cada cosa, por entrega. Leelo antes
  de cambiar algo que parezca raro; al cerrar una entrega, sumá sus decisiones.
- `design-system.md` + `CLAUDE.md` / `AGENTS.md`: reglas visuales del panel.
- `docs/INTEGRACION-IA-GHL.md`: arquitectura de la integración con GHL, pensada
  para replicarla en otro proyecto.
- `docs/EVALS-post-masterclass.md`: evals de la etapa post-masterclass.
- `.claude/informe-conversaciones.md`: configuración del informe de
  conversaciones (qué es error y qué no para este cliente).
