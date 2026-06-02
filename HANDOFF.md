# HANDOFF — Vanesa Rúas Formación Profesional (atp-vanesaruas)

Documento de onboarding para la próxima conversación de Claude Code que
trabaje en este proyecto. Cero contexto previo asumido.

---

## 1. Cliente

**Vanesa Rúas Formación Profesional** — formación para profesionales de la
estética. Comercializa:

- Múltiples **masterclass** (lanzamientos puntuales).
- **Skin Intellectuals Congress by Vanesa Rúas** (congreso, evento de mayor
  escala).

Los leads llegan por WhatsApp con consultas y/o comprobantes de pago para
inscripciones.

## 2. Lo que hay que construir

Asistente de IA en WhatsApp que:

1. **Responde FAQ** del catálogo de cursos: precios, fechas, modalidad,
   certificación, inscripción.
2. **Captura comprobantes de pago**: cuando el usuario envía un comprobante
   (imagen + datos), el sistema lo registra y notifica al equipo para
   validación manual.
3. **Deriva a humano** cuando la consulta lo requiere, con alerta por email
   al equipo.
4. **Alimenta un dashboard** con métricas y alertas.

El equipo sigue usando el celular con el número actual de WhatsApp en
paralelo (modo coexistencia oficial de Meta), no se migra el número.

## 3. Integración de WhatsApp — IMPORTANTE: NO es Baileys

El proyecto previo (Quintaglia) usa **Baileys** (librería no oficial que
scrapea WA Web). **Para Vanesa Rúas la integración es distinta:**

- **WhatsApp Business API + Modo Coexistencia** (oficial de Meta).
- **GoHighLevel (GHL)** como plataforma de conexión, CRM e inbox del
  equipo. GHL recibe los mensajes de WhatsApp y los reenvía al backend via
  webhook; el backend responde llamando a la API de GHL.
- **El bot de Baileys que vive en atp-quintaglia NO aplica acá.** No hace
  falta clonar `scripts/wa-bot/` ni el panel UI de `wa/`. Se construye una
  integración nueva tipo "provider GHL".

Flujo:

```
WhatsApp Business  →  GoHighLevel  →  webhook a nuestro backend
                                            │
                                            ▼
                              Agent (orchestrator + evaluator)
                                            │
                                            ▼
                            POST a GHL API para mandar la respuesta
```

A construir: `src/lib/providers/ghl/` con un `incoming` (parsea el webhook
de GHL y crea conversation + message + job) y un `outbound` (manda la
respuesta del agente a la API de GHL). El template ya tiene
`src/lib/providers/` como abstracción de proveedor de mensajería, con un
`test-provider` que sirve de molde.

## 4. Lógica específica del cliente

### 4.1 Eventos (nuevo modelo)

Cada masterclass + el Congress son "eventos" con:

- `slug` (ej. `congress-2026`, `masterclass-peeling-mayo`)
- nombre, descripción
- fechas (inicio, fin si aplica)
- precio (puede tener varias modalidades)
- modalidad (online / presencial / híbrido)
- estado (próximo / activo / pasado)
- certificación (sí/no, qué se entrega)

Necesario porque toda consulta y pago se asocian a un evento concreto, y
las métricas se desglosan por evento. Modelar como tabla `events` con su
migration de Supabase.

### 4.2 Validación de pagos (nuevo flujo)

Cuando el usuario informa/envía un pago, el agente:

1. Captura los datos: monto, evento al que aplica, imagen del comprobante,
   datos del contacto (nombre, email si lo da).
2. Registra una fila en una tabla nueva `payment_validations` con estado
   `pending`.
3. Llama a `notify_team` con categoría `payment_validation` (o
   `validacion_pago` — definir).
4. El equipo entra al dashboard, ve la fila pendiente, abre el comprobante
   (imagen), valida manualmente contra su contabilidad, y marca como
   `validated` o `rejected` desde el panel.
5. El email de notificación que ya viene del template (sendTeamNotificationAlert)
   dispara automáticamente para esta categoría también.

A construir:

- Migration `0XX_payment_validations.sql`: tabla con `id`, `conversation_id`,
  `event_slug`, `monto`, `comprobante_url`, `status`, `validated_by`,
  `validated_at`, `contacto_nombre`, `contacto_email`, timestamps.
- Storage de imágenes: usar Supabase Storage. Bucket privado, signed URLs
  para mostrarlas en el panel. Definir tamaño máx + tipos permitidos.
- Tool nueva del agente: `register_payment` con args `{event_slug, monto,
  contacto_nombre, contacto_email, comprobante_url}` — la registra en
  `payment_validations` y dispara `notify_team`.
- UI en el panel: tab "Pagos por validar" con la lista de pendientes,
  link a la conversación, vista del comprobante, botones validar /
  rechazar (con nota opcional).

### 4.3 Dashboard de métricas

A construir, tab "Dashboard" o "Métricas":

- **Volumen de consultas por evento** (masterclass / Congress, desglosado).
- **% respondido por IA vs respuestas humanas** (computar de `messages`:
  role `assistant` vs `human`).
- **Detalle por categoría** de respuestas / derivaciones (de
  `agent_notifications.category`).
- **Listado de alertas** pendientes (notificaciones sin atender).
- **Listado de pagos por validar** (`payment_validations` status=pending).

Stack sugerido: queries directas a Supabase con `count(*)` agrupados +
componentes React simples (sin librería de charts pesada todavía; si hace
falta visual avanzado, Tremor Blocks copy-paste).

## 5. Lo que YA viene resuelto del template

No reinventar lo que ya está en `atp-template`. Lo que hereda este repo:

- Panel Next.js (Testing, Conversaciones, Webhooks tabs, design system de
  [CLAUDE.md](CLAUDE.md)).
- Agent loop completo: orquestador + evaluator + sanitize + business-hours
  + prompt-builder compartido.
- Multi-tenant via RLS + claim `client_slug` del JWT.
- Worker de jobs (`/api/jobs/process`) con cron de Vercel.
- Webhooks salientes firmados HMAC.
- Harness de evals (`npm run eval`) — scenarios.ts vacío, sumar mientras se
  desarrolla.
- **Notificaciones por email** genéricas via Gmail SMTP
  ([src/lib/email/sender.ts](src/lib/email/sender.ts)) — dispara
  automáticamente en cada `agent_notifications` nueva (incluye
  `payment_validation` cuando se sume).
- Falla técnica reactiva (si el orquestador crashea, notifica al equipo
  sin mandar disculpa al cliente).

## 6. Lo que hay que customizar (orden sugerido)

1. **Slug y config**: ya está. Slug `vanesaruas`, puerto dev `3103`,
   `package.json` actualizado.
2. **`.env.local`**: copiar de `.env.example` y completar Supabase /
   Anthropic / Gmail / GHL (las de GHL hay que sumarlas al schema de env
   cuando se cree el provider).
3. **`src/lib/agent/prompts/orchestrator.md`**: persona del asistente
   (definir nombre o usar "el asistente de Vanesa Rúas"), flow de
   atención (recibir consulta → responder con KB / pedir info / capturar
   pago / derivar), disparadores (`fuera_de_conocimiento`,
   `escalado_manual`, `payment_validation`).
4. **`src/lib/agent/prompts/knowledge-base.md`**: cargar info de Vanesa
   Rúas (empresa, eventos activos con precios/fechas/modalidad,
   certificación, proceso de inscripción, datos de contacto, FAQ).
5. **Modelo de dominio**: migrations `events` + `payment_validations` +
   Supabase Storage bucket para comprobantes.
6. **Tool `register_payment`** en `src/lib/agent/tools/`.
7. **Provider GHL** en `src/lib/providers/ghl/` (incoming webhook +
   outbound API). Incluye env vars de GHL.
8. **Dashboard / Pagos por validar** como tabs nuevos en el panel.
9. **Eval scenarios**: sumar a `scripts/evals/scenarios.ts` casos críticos
   (consulta sobre Congress, captura de pago, derivación, etc.).
10. **Brand**: `src/components/BrandLogo.tsx` con el logo de Vanesa Rúas
    (PNG en `public/brand-logo.png`, override de BrandLogo per CLAUDE.md
    sección "Logo de cliente").

## 7. Decisiones abiertas (preguntar al usuario)

- **Nombre del asistente**: ¿tiene nombre propio (estilo "Mica" en
  Quintaglia, "Santino" en iBath)? ¿O queda como "el asistente de Vanesa
  Rúas"?
- **Tono de marca exacto**: el brief dice "profesional pero cercano"
  típico estética. Pedir ejemplos de mensajes reales del equipo si los
  hay.
- **OCR de comprobantes**: ¿v1 sin OCR (la imagen se guarda, los datos
  los tipea el cliente y el equipo valida manualmente)? ¿O directo con
  OCR (Claude vision lee el comprobante)? Recomendado v1 sin OCR — más
  simple, más confiable; OCR se suma después si vale.
- **Lista exacta de masterclass + datos del Congress** para cargar la KB.
- **Credenciales de GoHighLevel** (API key, location ID, webhook URL).
- **Email del equipo** para `EMAIL_NOTIFY_TO`.
- **Repo de GitHub**: el origin ya apunta a
  `https://github.com/fedeDelPercio/atp-vanesaruas` pero el repo todavía
  no está creado. Crearlo en GitHub (privado) y `git push -u origin main`.

## 8. Estado actual

- Clonado de `atp-template` v1 (commit inicial del template).
- `package.json` con nombre `atp-vanesaruas` y dev port `3103`.
- Origin git apuntando a `fedeDelPercio/atp-vanesaruas` (repo a crear).
- Nada del flow específico del cliente está construido todavía. Stubs del
  template (`orchestrator.md`, `knowledge-base.md`, `BrandLogo.tsx`,
  `SplashScreen.tsx`) siguen sin reemplazar.
- Sin `.env.local` (cargar antes de correr).

## 9. Clientes hermanos como referencia

- **iBath** (`c:\dev\Claude\atp-ibath`): agente comercial con harness de
  evals + falla técnica + el patrón completo de prompt-builder. Buen
  ejemplo de un orchestrator.md maduro.
- **Quintaglia** (`c:\dev\Claude\atp-quintaglia`): único con bot Baileys
  (NO aplica acá), pero tiene el sistema de **Leads** + el sender de
  email original (acoplado a `leads`). Buen ejemplo de cómo se hace una
  tabla extra para un flow específico del cliente.
- **STAG** (`c:\dev\Claude\atp-stag`): independiente, panel de gestión
  de propiedades. Ejemplo de cómo se modela un dropdown de selección
  (propiedad) en el panel — análogo al dropdown de evento que vamos a
  necesitar.

Para sincronizar mejoras de plataforma desde otros clientes, cherry-pick
selectivo por path. **NO** `git merge` directo desde otra branch:
sobreescribe prompts.

## 10. Comandos útiles

```bash
# instalar
npm install

# dev (puerto 3103)
npm run dev

# typecheck
npm run typecheck

# correr suite de evals (cuando haya scenarios cargados)
npm run eval

# filtrar evals por nombre
npm run eval -- "validacion pago"
```
