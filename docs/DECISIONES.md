# Decisiones · atp-vanesaruas

Por qué se eligió cada cosa, agrupado por entrega (la más nueva arriba).
Qué hay y cómo funciona está en `CONTEXTO-PROYECTO.md`; la evidencia del QA de
cada entrega, en `qa/`. Al cerrar una entrega, sumá acá sus decisiones: qué se
decidió, por qué, qué se descartó y qué costo o pendiente deja.

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
