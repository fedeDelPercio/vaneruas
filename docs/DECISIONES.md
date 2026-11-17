# Decisiones · atp-vanesaruas

Por qué se eligió cada cosa, agrupado por entrega (la más nueva arriba).
Qué hay y cómo funciona está en `CONTEXTO-PROYECTO.md`; la evidencia del QA de
cada entrega, en `qa/`. Al cerrar una entrega, sumá acá sus decisiones: qué se
decidió, por qué, qué se descartó y qué costo o pendiente deja.

---

## 17/11/2026 · Panel consolidado de revisión (`/revision`)

**Qué entró**

- Ruta `/revision` ("Revisión" en el nav, al lado de Aprobaciones, mismos roles
  y mismo contador). Tres columnas en desktop: cola de pendientes, chat de
  WhatsApp de esa persona y, a la derecha, el archivo con Aprobar / Rechazar,
  sus derivaciones abiertas y el estado del acceso a Tiendup. En mobile, tres
  pestañas. El ítem seleccionado va en `?id=` (id del comprobante o del
  título).
- `FileReviewPanel`: el contenido de `FileReviewModal` extraído a un componente
  compartido (el modal de la ficha de /wa lo envuelve; /revision lo usa en
  línea).
- `GET /api/payments?with=interventions` (opcional) y
  `loadOpenTeamNotificationCounts` en `src/lib/interventions.ts`.
- La ficha (`GET /api/wa/contact/[id]`) suma `access.error`: el motivo del
  último intento de alta en Tiendup que no salió.
- Aprobaciones acepta `?filter=sin-acceso` para abrir directo en "Falta
  acceso".

**D-32 · Reutilizar en vez de endpoints nuevos.** La cola sale de la misma
respuesta de `GET /api/payments` que Aprobaciones (pendientes, retenidos por
título y títulos para revisar, con la búsqueda server-side de `?q=`), el chat
es `WaChatPanel` tal cual (composer y modo incluidos, con la allowlist y el
modo que ya respeta; no se agregó ningún envío) y la columna derecha usa la
ficha de /wa. Las acciones son las mismas `PATCH /api/payments/[id]` y
`PATCH /api/titles/[id]`, así que el alta automática, el cierre de
notificaciones de pago y los avisos por WhatsApp se comportan igual que desde
Aprobaciones. Descartado: un endpoint `/api/revision` propio (duplicaba la
lógica de duplicados, retenciones y títulos de `/api/payments`).

**D-33 · Un archivo por ítem.** En Aprobaciones los títulos sin revisar van
dentro de la tarjeta del comprobante; acá cada comprobante y cada título es un
ítem propio, porque la columna derecha muestra un solo archivo con sus dos
botones. Orden: el más antiguo primero (cola de trabajo, como Aprobaciones).
Tras aprobar o rechazar se recarga la cola y se pasa al siguiente de la cola
anterior que siga pendiente (también si otra persona lo resolvió desde otra
pantalla).

**D-34 · El indicador de intervención no cuenta `validacion_pago`.** Con el
criterio de `loadInterventionConversationIds` (el del filtro de /wa), todo
comprobante pendiente cuenta como intervención: en esta cola marcaría a todos y
no diría nada. Acá cuenta solo derivaciones del agente, reclamos de
certificado y altas de Tiendup que no salieron (lo mismo que muestra la ficha).
La consulta filtra por `client_slug` explícito además de RLS y solo corre con
`?with=interventions`, así Aprobaciones no paga ese costo.

**D-35 · Realtime con filtro `client_slug`.** La cola escucha
`payment_validations`, `professional_titles` y `agent_notifications` con
`client_slug=eq.<slug>` (como los mensajes en /wa) y agrupa ráfagas con una
espera de 800 ms. La ficha de la derecha se vuelve a pedir con cada recarga de
la cola, sin canal propio.

### Pendientes que deja esta entrega

- Probar `/revision` contra datos reales (el build y los chequeos corrieron con
  env dummy, sin red).
- La cola recarga `GET /api/payments?status=pending` completo en cada cambio
  (igual que Aprobaciones): si se vuelve lento, es el mismo punto que H-25.
- Las URLs firmadas de los archivos duran 5 minutos: si alguien deja un ítem
  abierto más tiempo sin que entre ningún cambio, "Abrir" puede fallar hasta la
  próxima recarga.

## 17/11/2026 · Interruptor del alta automática en Tiendup en el panel

**Qué entró**

- Interruptor "Alta automática en Tiendup" en Aprobaciones → Falta acceso, con
  estado, fuente y quién/cuándo lo cambió. Dev y client lo cambian; asesor lo
  ve en solo lectura.
- `GET/PATCH /api/settings/tiendup-auto-enroll` y migración
  `033_agent_settings.sql` (documental, no hace falta correrla).

**D-28 · Reutilizar `agent_settings` en vez de una tabla nueva.** La tabla ya
existe en el Supabase compartido (una fila por tenant, RLS por `client_slug`,
jsonb `auto_send`). El flag va en `auto_send.tiendup_auto_enroll`, sin cambio
de esquema. Quién/cuándo van dentro del jsonb
(`tiendup_auto_enroll_updated_by` / `_updated_at`) porque `updated_by` /
`updated_at` de la fila son de cualquier setting. La migración 033 solo la
documenta (idempotente) para que el repo sea reproducible. Descartado: una
columna nueva o una tabla `panel_settings` propia (migración a aplicar en una
base compartida con otros paneles).

**D-29 · Prioridad base > env > prendido, sin cache.** El panel manda cuando
hay valor; la env `TIENDUP_AUTO_ENROLL` queda como respaldo (y como estado
inicial antes de que alguien toque el interruptor). Si la lectura falla (tabla
inexistente, red, RLS) se loguea una sola vez y se cae a la env: el alta nunca
se rompe por el setting. Sin cache para que apagarlo frene la próxima alta al
instante; el costo es una query chica por disparo. Siempre con el cliente JWT
(RLS), nunca service role.

**D-30 · Confirmación solo al prender.** Prender impacta a todos los pagos que
estén esperando acceso; apagar es la acción segura y va directo. Optimistic
update con rollback si el PATCH falla.

**D-31 · Auth del interruptor por perfil (fase 1).** Igual que el resto del
panel: el `profileId` viaja desde el navegador y el rol se lee de `profiles`.
Es el mismo nivel de confianza que hoy (no hay auth real); cuando la haya, esta
ruta tiene que leer la sesión.

### Pendientes que deja esta entrega

- Probar el interruptor en producción (la fila de vanesaruas en
  `agent_settings` se crea con el primer cambio).

---

## 17/11/2026 · Alta automática en Tiendup, pedido del correo y filtro de intervención

**Qué entró**

- Alta automática en Tiendup de los pagos de masterclass validados (flag
  `TIENDUP_AUTO_ENROLL`, prendido por defecto) y aviso por WhatsApp cuando el
  acceso queda dado.
- Valentina pide el correo cuando llega un comprobante y no lo tenemos; el
  correo se valida antes de guardarlo.
- Nuevo texto de comprobante recibido, con el aviso de revisión manual.
- Ficha de /wa: miniaturas de comprobantes y títulos con modal para aprobar o
  rechazar.
- Filtro "Intervención" en /wa con contador, y las notificaciones de pago se
  resuelven al revisar el comprobante.

**D-20 · Federico pidió automatizar el alta en Tiendup.** La regla dura "dar
acceso es siempre humano" cambia (CONTEXTO, regla 6). La automática usa
`grantCourseAccess`, la misma función que el botón, en un modo más estricto:
exige correo con formato válido, no inscribe si el listado de inscriptos no se
leyó completo (con el listado cortado no se puede descartar que figure con otro
correo) y nunca fuerza. Por qué: el cliente fantasma en Tiendup es el error caro.
El botón queda como respaldo y para forzar.

**D-21 · Condición del alta: pago validado y sin retención por título.** Un
pago validado sin `awaiting_title` ya pasó el gate (título aprobado, clienta
registrada o aprobación forzada por el equipo), así que no se vuelve a mirar
`professional_titles`. Solo masterclass con `accesoVigente` (mismo criterio que
"Falta acceso"); el Congreso no tiene curso.

**D-22 · Disparadores: al validar el pago, al validarse el título y al llegar
el correo.** En las rutas del panel corre con `after()`, después de responder:
aprobar nunca espera ni falla por Tiendup. En el worker corre en línea dentro
de un try.

**D-23 · Sin categoría nueva para los casos que no se pueden dar de alta.** La
base compartida tiene un CHECK sobre `agent_notifications.category` fuera de
las migraciones. Se usa `escalado_manual` con la marca en `reason`
(`tiendup_alta_pendiente_<pago>`, `tiendup_aviso_sin_enviar_<pago>`): una
notificación abierta por pago, que se actualiza si cambia el motivo y se
resuelve sola cuando el alta sale bien (automática, botón o "Ya tiene
acceso"). `reason` no se muestra en el panel ni en el email. El agente ignora
estas notificaciones al deduplicar sus derivaciones y al armar el "Estado de
derivación": si no, un alta pendiente silenciaba una derivación real de
`escalado_manual`. No se propone migración: no hizo falta.

**D-24 · El aviso de acceso se manda tras el alta automática y tras "Dar
acceso al curso" (también si ya estaba inscripta), no tras "Ya tiene acceso".**
"Ya tiene acceso" es un caso resuelto por afuera: no sabemos si le llegó el
correo de Tiendup. Idempotencia sin columna nueva: no se manda si ya hay un
mensaje con ese texto en la conversación desde el primer comprobante de ese
evento. Si el envío falla, `delivery_failed` en el comprobante (se ve como "No
se avisó al cliente") y una notificación al equipo. Como el resto de los
envíos automáticos, en modo Humano queda guardado pero no sale.

**D-25 · El pedido del correo va en código y en el prompt.** En el flujo de
comprobante (determinístico) sale como burbuja aparte si no hay correo
guardado, en el texto ni en los últimos 15 mensajes, una vez por día. Además
el orquestador ve en "Pagos de esta conversación" si ya tenemos el correo, y la
base de conocimiento explica el pedido (el evaluator no ve el orquestador).

**D-26 · "Derivadas" pasa a "Intervención".** Patrón del panel de Hábitat:
conversaciones con notificaciones sin resolver. Entran todas las categorías
(incluidos los reclamos de certificado y las altas de Tiendup), y
`validacion_pago` solo si la conversación tiene un comprobante `pending` sin
retención por título (lo retenido espera a la contacta, no al equipo).
Criterio en `src/lib/interventions.ts`, paginado y cruzado en memoria.

**D-27 · Las `validacion_pago` se resuelven al revisar el último comprobante
pendiente de la conversación.** La notificación solo guarda la conversación,
no el comprobante. Volver un comprobante a pendiente no reabre la
notificación. El histórico (~685 abiertas) se limpia con
`supabase/cleanup/2026-11-17-resolver-notificaciones-pago.sql`, escrito y sin
correr.

### Pendientes que deja esta entrega

- Correr (o no) el SQL de limpieza histórica.
- Probar en producción el alta automática con un caso real antes de confiar
  en ella; mientras tanto se puede apagar desde el panel (o con
  `TIENDUP_AUTO_ENROLL=false` si no hay valor en la base).
- El texto de comprobante dice "No hace falta que vuelvas a escribir" y, si
  falta el correo, a continuación se lo pedimos. Confirmar con el cliente.

---

## 17/11/2026 · Chat del equipo, buscador, ficha del contacto y botón de feedback

**Qué entró**

- `/wa` pasa a ser la bandeja de WhatsApp del equipo: lista paginada con
  filtros (Todas, Derivadas, Humano), tomar la conversación, escribirle a la
  clienta desde el panel y devolverla a Valentina.
- Buscador por nombre o teléfono en Chats, Aprobaciones, Derivaciones,
  Certificados y Agendar. "Ver chat" en cada tarjeta abre la conversación.
- Ficha del contacto al costado del chat: eventos, pago, acceso, título,
  certificados y derivaciones.
- Botón de feedback en el header: Mejora o Bug, con audio transcripto y
  capturas, que llega como ticket a AI ScaleMap.
- Correcciones en bandejas que ya existían: Agendar vacío y badges en 0, la
  misma persona dos veces en Pendientes, tarjetas de Agendar sin mensajes,
  fotos de Aprobaciones que trababan la página.

QA: `qa/plan-2026-11-16.md` y `qa/hallazgos-2026-11-16.md`.

### Chat

**D-1 · Para escribirle a una clienta hay que tomar la conversación.** El
envío exige modo Humano. Por qué: con Valentina activa, contestaría encima del
equipo en el próximo mensaje de la clienta. Antes, el cuadro de texto de `/wa`
era el del banco de pruebas: lo que se escribía entraba como si lo hubiera
dicho la clienta y Valentina le respondía a la persona real.

**D-2 · Tomar y devolver desde el panel pone y saca el tag de pausa en GHL.**
Por qué: el modo cambia por tres caminos (tag de GHL, chat del panel,
interruptor general) y tienen que quedar coherentes. El interruptor general, al
reactivar la IA, respeta a quien tiene el tag: una conversación tomada desde el
panel sin tag volvería sola a Valentina. Si GHL no acepta el tag, el modo queda
guardado igual y el chat lo avisa con un botón para reintentar.

**D-3 · Tomar una conversación respeta `GHL_SEND_ALLOWLIST`, igual que el
envío.** Por qué: el panel local apunta a la base real. Tomar una conversación
desde un entorno que no le puede escribir a esa clienta la deja sin Valentina y
sin nadie que le conteste. En producción la lista es `*` y no cambia nada.
Devolver a Valentina se permite siempre.

**D-4 · Si el equipo toma la conversación mientras Valentina redacta, la
respuesta se descarta.** El worker relee el modo después de correr el agente.
Por qué: mejor callar que contestarle encima a una persona del equipo. Costo:
si la toman y la devuelven en esos segundos, la clienta queda sin respuesta
hasta que vuelva a escribir (N-3 en el QA).

**D-5 · Si falla un envío, el mensaje de error distingue tres casos y no hay
reintento automático.** GHL lo rechazó (no salió; lo más común es la ventana
de 24 h), falta configuración (no salió), o no se sabe (timeout o corte de
red). Por qué: en el tercer caso reenviar a ciegas puede hacer que la clienta
reciba el mensaje dos veces, así que se pide mirar GHL antes.

**D-6 · Los mensajes del panel se guardan con el id de GHL.** Van con
`role="human"`, `external_id` y `delivered_at`. Por qué: el importador de
mensajes del equipo (los que se escriben en GHL) los reconoce por ese id y no
los duplica.

**D-7 · La conversación abierta vive en la URL (`/wa?id=`).** Por qué: se puede
recargar o pasar el link y abre la misma, y es como "Ver chat" llega desde las
otras bandejas. Se actualiza con `history.replaceState` y no con la navegación
de Next, porque así cambiar de conversación tardaba segundos.

### Buscador

**D-8 · La búsqueda la resuelve el servidor sobre todo el historial.** No
filtra solo lo que ya está cargado en pantalla. La lista muestra hasta 300
filas y el contador dice "300 de N". Por qué: las bandejas cargan una parte
del historial, y buscar solo sobre eso no encuentra a quien quedó afuera.

**D-9 · El teléfono se busca como se dicta.** Con o sin 0 y 15, con espacios,
guiones o `+54 9`; el nombre, sin distinguir tildes. Por qué: el equipo copia el
número de donde lo tenga, y GHL lo guarda en formato internacional.

### Ficha del contacto

**D-10 · Primero los eventos activos, y el monto es la suma de lo aprobado.**
Se suman los comprobantes aprobados sin contar dos veces el mismo número de
operación. La ficha avisa si hay un comprobante retenido por título o uno
pendiente detrás de uno aprobado. Por qué: hay quien paga en dos partes, y la
primera versión de la ficha mostraba solo el primer comprobante (H-23).

**D-11 · El comprobante se une con su evento por `titleKeyword`
(`event-match.ts`).** Por qué: la tabla `events` no guarda el slug del evento.
Costo: al sumar una masterclass hay que cargar esa palabra, o su ficha queda
sin pagos.

### Datos

**D-12 · Nada de cientos de ids en un `.in(...)`.** Se traen las listas
paginadas (`fetchAllRows`) y se cruzan en memoria, o se parten en tandas. Por
qué: la lista viaja en la URL y pasada cierta longitud el pedido falla en
silencio. Era la causa de Agendar vacío, badges en 0 y tarjetas sin nombre.

**D-13 · El interruptor general ya no toca `updated_at`, pero las fechas ya
pisadas no se corrigieron.** Unas 600 conversaciones tienen esa fecha pisada
por actualizaciones masivas viejas (6/8 y 13/10) y se ordenan mal bien abajo
en la lista. Por qué no se corrigió: es reescribir datos de producción en la
base compartida. Queda para cuando se decida (H-20).

### Botón de feedback

**D-14 · Solo Mejora o Bug, y sin campo de título.** Se mapean a `improvement`
y `bug` de AI ScaleMap; el título es la primera línea del texto. Por qué: es
como funciona el feedback del propio AI ScaleMap y es lo que se pidió.

**D-15 · El audio se transcribe tal cual, sin IA que lo ordene.** Usa el mismo
`/api/transcribe` que el panel ya tenía para los audios de WhatsApp. Se
descartó el dictado ordenado de AI ScaleMap, que reescribe el texto con un
modelo: se pidió solo la transcripción.

**D-16 · Las capturas se achican en el navegador antes de mandarlas.** WebP (o
JPEG en Safari) a 2000 px de lado como máximo, con tope de 10 capturas y 4 MB
en total. Por qué: Vercel corta los pedidos de más de 4,5 MB, y dos o tres
pantallazos en PNG ya lo superaban.

**D-17 · La clave del panel vive en la base, no en Vercel.** Va en
`integration_tokens` (provider `aiscalemap`); AI ScaleMap guarda solo su hash
en `TICKET_INTAKE_KEYS`. Por qué: es el mismo patrón que STAG, y cambiar la
clave no obliga a redesplegar el panel. El nombre de quien reporta sale de
`profiles`, no de lo que mande el navegador.

**D-18 · La pantalla de origen va sin lo que se estaba buscando.** El ticket
lleva la ruta y `?id=`, pero no `?q=`. Por qué: el texto buscado suele ser el
teléfono de una clienta, que no tiene por qué quedar guardado en otro sistema.

**D-19 · En AI ScaleMap, el intake acepta capturas sin cambiar lo de STAG.**
`/api/intake/tickets` acepta multipart con `images`; el JSON sigue igual.
Primero sube las capturas y después crea el ticket. Por qué: si una captura no
sube, no queda un ticket a medias.

### Pendientes que deja esta entrega

- **Quién del equipo envió cada mensaje** (H-37): necesita una columna nueva en
  la base compartida.
- **Regla de títulos** (H-38): Aprobaciones pide revisar el título de alguien
  que ya tiene otro validado. Falta decidir qué debería pasar.
- **`updated_at` pisado** (H-20): ver D-13.
- **Medir Aprobaciones en producción** (H-25): en local tardaba más de 5 s de
  forma intermitente.
- **Probar en producción el envío real de un mensaje del equipo:** el QA corrió
  en solo lectura contra producción.
