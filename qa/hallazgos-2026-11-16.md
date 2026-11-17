# Hallazgos de QA · 2026-11-16

Plan: `qa/plan-2026-11-16.md`. Modo solo lectura (la app local apunta a la base de producción). Tres agentes: pantallas, datos y código.

Foto de control: antes 22 en Humano · 939 validados · 400 rechazados · 706 accesos · 4 derivaciones pendientes. Después: igual. Lo único que se movió fue por tráfico real (una conversación y un comprobante pendiente nuevos).

## Cobertura

| Flujo | Dueño | Resultado |
|---|---|---|
| F1 Lista del chat (8 pasos + bordes) | UI | PASA, con H-13, H-18, H-27 |
| F2 Panel de chat (9 pasos + bordes) | UI | PASA salvo 768 px (H-7). `---` dentro de un mensaje: NO PROBADO (ninguna conversación visitada lo tiene) |
| F3 Ficha del contacto, pasos 1 a 4 | UI | FALLA paso 3 (H-4), resto PASA |
| F3 paso 5, ficha contra la base | datos | PASA en 1232 conversaciones, 0 diferencias. Bordes: H-23 |
| F4 Buscador en bandejas (5 pasos + bordes) | UI | PASA, con H-5 |
| F5 Carga completa (10 pasos) | datos | PASA 1 a 9 (1494 comprobantes, 1561 conversaciones, todo igual a la base). Paso 10 (tiempos) FALLA intermitente (H-25) |
| F6 Envío y modo (código + validaciones 4xx) | código | Validaciones PASA. Lectura: H-1, H-2, H-3, H-10 a H-12, H-14, H-16 |
| F7 Regresión | UI | PASA, con H-6 y H-17. `/conversations` visual: NO PROBADO (banco vacío, crear una conversación es escribir) |

## Hallazgos

Estados: `corregido` (pendiente de retest), `PASA` (retest hecho), `por diseño`, `descartado`, `pendiente`.

### Altos

| Id | Qué pasa | Origen | Veredicto | Estado |
|---|---|---|---|---|
| H-1 | Valentina podía contestar encima del equipo: el modo se leía antes de redactar y no se volvía a mirar antes de enviar | código | Confirmado leyendo `jobs/process/route.ts` | corregido: se vuelve a leer el modo después de redactar y la respuesta se descarta |
| H-2 | Con la IA apagada para todos, lo que el equipo atendía desde el panel volvía a Valentina al reactivarla (quedaba en Humano sin la etiqueta de GHL y no había forma de "tomarla") | código | Confirmado | corregido: enviar un mensaje desde el panel pone la etiqueta de pausa |
| H-3 | Si GHL no aceptaba la etiqueta, el aviso no decía qué implicaba | código | Confirmado | corregido: un reintento y aviso con la consecuencia |
| H-4 | "Resolver en Aprobaciones" abría la lista completa, sin filtrar por la persona | UI | Confirmado: `window.location` todavía tenía la URL anterior al llegar por un link interno | corregido: se lee con `useSearchParams` |
| H-5 | Derivaciones, Certificados y Agendar cargaban 300 y el buscador solo buscaba ahí (Agendar: 300 de 880; Derivaciones: 300 de 992) | UI + datos | Confirmado | corregido: la búsqueda la hace el servidor sobre todo el historial y el contador dice "300 de 992" |
| H-6 | La misma persona aparecía dos veces en Pendientes: una con su comprobante y otra como "Sin comprobante" con los mismos títulos | UI + datos | Confirmado. Ya pasaba antes de esta entrega | corregido en `payments` y en el badge |
| H-7 | Cabecera del chat rota entre 768 y 890 px (nombre en una letra, selector tapando el teléfono) | UI | Confirmado | corregido |
| H-8 | "Ver chat" tardaba unos 30 s después de pasar por la pestaña "Todos" de Aprobaciones (880 tarjetas, 1789 imágenes) | UI | Confirmado en `next dev` | corregido en parte: imágenes con carga diferida. La pestaña sigue pintando todas las tarjetas (ver Pendientes) |
| H-9 | "Marcar atendida" del chat también cerraba reclamos de certificado | UI + código | Confirmado | corregido: el cartel usa el mismo criterio que Derivaciones |

### Medios

| Id | Qué pasa | Origen | Veredicto | Estado |
|---|---|---|---|---|
| H-10 | Envío sin confirmar: el aviso mandaba a mirar el chat, donde el mensaje tarda hasta 5 minutos en aparecer; y un corte de red se informaba como "rechazado, 24 hs" | código | Confirmado | corregido: tres casos distintos (rechazado, sin configurar, incierto) y el aviso manda a GoHighLevel |
| H-11 | Mensaje enviado pero no guardado: desaparecía sin aviso | código | Confirmado | corregido: aviso "va a aparecer en unos minutos" |
| H-12 | El importador de mensajes del equipo podía duplicar un envío del panel (sin id de GHL, o si el cron caía justo en el medio), y un envío del panel adelantaba su marca de agua | código | Confirmado | corregido en `ghl-human.ts` y en la ruta de envío |
| H-13 | Pasadas las 300 filas, la lista del chat se recortaba y saltaba con cada actualización | UI + código | Confirmado | corregido: la actualización conserva lo ya cargado |
| H-14 | Aprobaciones cortaba en 2000 comprobantes descartando los más nuevos; errores de consulta tragados en silencio | código | Confirmado (latente, hoy hay 1495) | corregido: sin tope, y el error se informa |
| H-15 | El buscador no encontraba teléfonos como se dictan ("011 6574-6690", "15 6574 6690") ni nombre y número juntos | código + UI | Confirmado | corregido, 18 casos probados |
| H-16 | "Devolver a Valentina" decía que volvía a responder, pero lo que la clienta escribió mientras tanto queda sin respuesta | código | Confirmado. Que no retome lo viejo es por diseño | corregido el texto: "desde el próximo mensaje de la clienta" |
| H-17 | En Aprobaciones, el chip "Todos" no coincidía con el contador (dejaba afuera los comprobantes sin evento) | UI | Confirmado. Ya pasaba antes | corregido |
| H-18 | Mientras busca, la lista del chat mostraba los resultados anteriores sin señal clara | UI | Confirmado | corregido: la lista se atenúa y vuelve arriba |
| H-19 | "Message type is currently not supported." como si lo hubiera escrito la clienta | UI | Confirmado. Es un texto fijo de GHL | corregido en el chat y en la vista previa |
| H-20 | La lista se ordena por última actividad, pero 608 conversaciones tienen esa fecha pisada por actualizaciones masivas viejas (6/8 y 13/10). Se nota desde la posición 434 | UI + datos | Confirmado | pendiente: corregirlo es reescribir `updated_at` en producción. La causa (el interruptor general pisaba la fecha) sí quedó corregida |
| H-21 | Cambiar quién atiende es un solo clic | UI | Por diseño: tomar una conversación tiene que ser inmediato y es reversible | por diseño. Se agrandó el botón en celular |
| H-22 | El resumen de la derivación se cortaba sin forma de leerlo entero | UI | Confirmado | corregido: se expande al tocarlo |
| H-23 | Ficha: mostraba el monto del primer comprobante aprobado aunque hubiera pagado en dos partes; no avisaba de un comprobante retenido por título ni de uno pendiente detrás de uno aprobado | datos | Confirmado | corregido |
| H-24 | Agendar: tres tarjetas pendientes salían sin los mensajes de la clienta | datos | Confirmado | corregido |
| H-25 | Aprobaciones tarda más de 5 s de forma intermitente (lo normal es 1 a 3 s) | datos | Probable: medido en `next dev` con tres agentes usando el servidor | pendiente de medir en producción |
| H-26 | La ficha no muestra un evento cuando todos sus comprobantes fueron descartados | UI | Por diseño: una imagen descartada nunca fue un pago | por diseño |

### Bajos

| Id | Qué pasa | Estado |
|---|---|---|
| H-27 | Una búsqueda nueva no volvía al principio de la lista | corregido |
| H-28 | Con las notas abiertas, el botón de la ficha cerraba todo y guardaba "ficha cerrada" | corregido |
| H-29 | Con un id inválido, la ficha quedaba abierta con "Reintentar" | corregido |
| H-30 | "Ver mensajes anteriores" podía saltear mensajes con la misma hora y no cargaba sus reacciones | corregido |
| H-31 | `formatPhone` agrupaba mal números del interior y los que no traen código de país | corregido |
| H-32 | La ficha y los contadores tragaban errores de consulta | corregido en la ficha |
| H-33 | La ficha unía comprobantes con eventos por una palabra del título, sin orden | corregido: activos primero |
| H-34 | Animación con rebote en "Valentina está escribiendo" | corregido |
| H-35 | El contador junto a "WhatsApp" mostraba "0" mientras cargaba | corregido |
| H-36 | Buscadores con letra de 13 px (iOS hace zoom al enfocar) | corregido: 16 px en celular |
| H-37 | Los mensajes del equipo no guardan quién los envió | pendiente: necesita una columna nueva en una base compartida |
| H-38 | Aprobaciones pide revisar el título de alguien que ya tiene otro validado; títulos rechazados por una persona que figuran válidos por un envío anterior | pendiente: regla de negocio, se le pregunta a Federico |
| H-39 | Las bandejas muestran la hora en 12 hs y el teléfono sin formato; el botón Atrás no vuelve a la conversación anterior; el cuadro de texto corta en 4000 caracteres sin avisar | pendiente (cosmético, ya era así o de bajo impacto) |

## Datos para mirar con el equipo (no son errores de la entrega)

- Un mismo N° de operación validado en dos conversaciones distintas.
- 132 comprobantes validados el 6/8 sin "validado por".
- Agendar: 52 de los 89 pendientes no tienen ningún pago aprobado.
- Comprobantes de montos que no son del evento al que quedaron asociados (por el evento por defecto).

## Retest (17/11)

Dos agentes: uno reprodujo en pantalla cada hallazgo corregido con sus pasos originales y otro revisó que los arreglos resuelvan el problema sin romper otra cosa. Después de sus reportes se corrigió lo que encontraron y se volvió a verificar en el navegador.

| Id | Resultado |
|---|---|
| H-1 | PASA (código). Quedan ventanas de segundos al enviar varias burbujas y en el reintento de la cola de salida; ver N-3 |
| H-2, H-3 | PASA. Si GHL no acepta la etiqueta, el chat lo dice y ofrece "Reintentar" (antes no había cómo) |
| H-4 | PASA desde dos conversaciones, ida y vuelta |
| H-5 | PASA: "300 de 880" en Agendar, "300 de 992" en Derivaciones; personas fuera de las 300 aparecen buscando |
| H-6 | PASA: la persona aparece una sola vez, con sus títulos dentro de la tarjeta del comprobante |
| H-7 | PASA de 390 a 1440 px |
| H-8 | PASA: "Ver chat" desde "Todos" abre en 1 a 3 s. Además "Todos" ahora pinta de a 100 contactos ("Mostrar más"): cargar la pestaña bajó de 7 a 14 s a 4 s y cambiar de pestaña ya no congela |
| H-9 | PASA: el cartel ya no cuenta el reclamo de certificado |
| H-10 a H-12 | PASA (código) |
| H-13 | PASA: con 360 filas cargadas, una actualización no mueve nada |
| H-15 | PASA: 25 de 25 casos, incluidos "tamara 011 6574-6690" y "ponce, tamara" |
| H-17 | PASA en las 5 pestañas |
| H-18, H-27 | PASA |
| H-19 | PASA; ninguna vista previa trae el texto en inglés |
| H-22 | FALLÓ en el retest (el texto nunca se recortaba), corregido y verificado: 39 px contraído, 78 px abierto |
| H-23 | PASA en los tres casos |
| H-24 | PASA (API): las tres tarjetas traen sus 2 mensajes |
| H-28, H-29, H-35, H-36 | PASA |

Problemas nuevos que encontró el retest:

| Id | Qué pasa | Estado |
|---|---|---|
| N-1 | Con un filtro, una fila que salía del filtro (derivación atendida) quedaba pegada en la lista | corregido: con filtro manda lo que dice el servidor |
| N-2 | Una actualización en vivo podía pisar una búsqueda en curso y mezclar resultados | corregido: las actualizaciones esperan a que termine la búsqueda |
| N-3 | Si el equipo toma y devuelve la conversación mientras Valentina redacta, esa respuesta se descarta y la clienta queda sin contestar hasta que vuelva a escribir | pendiente: es el costo del arreglo de H-1, en una ventana de segundos. Mejor callar que contestar encima |
| N-4 | "Probá de nuevo en un rato" no tenía cómo hacerse | corregido: botón "Reintentar" |
| N-5 | La marca de agua del importador se congelaba si el equipo escribía solo desde el panel | corregido: ventana máxima de 24 hs |
| N-6 | Nombre + teléfono con espacios, o palabras con coma, no se encontraban | corregido |
| N-7 | El descarte de H-1 no deja la traza en el job ni el cartel "Derivado al equipo" si ya había derivado | pendiente (bajo: la derivación sí figura en Derivaciones y en el cartel de arriba del chat) |
| N-8 | La etiqueta al enviar podía fallar en silencio | corregido: el envío informa y el chat muestra "Reintentar" |
| N-9 | Pasadas las 300 filas, una conversación nueva hacía desaparecer otra | corregido junto con N-1 |
| N-10 | Un mensaje muy corto del panel sin id de GHL se puede duplicar | pendiente (requiere que GHL no devuelva el id, no pasó nunca en las pruebas) |
| N-11 | Aprobaciones traga el error si falla la lectura de títulos | pendiente (bajo) |
| N-12 | El cuadro de texto del chat hacía zoom en iPhone | corregido |
| N-13 | La ficha decía "pago retenido por título" y "no hizo falta pedirlo" a la vez | corregido |
| N-14 | Elegir una conversación a veces tardaba varios segundos sin señal | corregido: cambia al instante (0,2 a 0,8 s medido) |
| N-15 | Con un id inválido, el navegador igual consultaba la base | corregido |

Otros cambios después del retest:

- **Tomar una conversación respeta la lista de envío permitido**, igual que escribir. En producción (lista "*") no cambia nada. En local, que apunta a la base real, solo se pueden tomar las conversaciones de los contactos de prueba: con una clienta real devuelve "no se puede tomar la conversación desde acá" y el modo no cambia (verificado).

## Cierre

- `tsc` y `lint` sin errores. `next build` de producción completo.
- Foto de control final igual a la inicial: 22 en Humano, 939 validados, 400 rechazados, 706 accesos, 988 derivaciones atendidas. Lo único que subió fue por tráfico real (1 conversación y 1 comprobante pendiente).
- Durante el QA solo se escribió en el contacto de prueba de Federico (modo y etiqueta de ida y vuelta, quedó en IA y sin etiqueta) y nada más.

No cubierto (hace falta probarlo a mano con un contacto de prueba):
- Enviar un mensaje real desde el panel y verlo llegar al WhatsApp, y que el importador no lo duplique a los 5 minutos.
- Tomar una conversación mientras Valentina redacta (H-1 de punta a punta).
- Mensajes en vivo: "N mensajes nuevos", "Valentina está escribiendo", cambio de modo desde GHL reflejado en el chat.
- Tiempos en producción (todo se midió en `next dev`).
