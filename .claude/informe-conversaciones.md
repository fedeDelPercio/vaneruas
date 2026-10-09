---
panel_url: https://vaneruas.vercel.app
schema: public
fuente: whatsapp
herramientas:
casos: validacion_pago, escalado_manual, fuera_de_conocimiento, falla_tecnica, reclamo_certificado
---

# Informe de conversaciones · Vanesa Rúas Formación Profesional (Valentina)

## Contexto

- **Valentina** es la asistente IA de Vanesa Rúas Formación Profesional, una
  escuela de especializaciones para profesionales de la estética (cosmiatría,
  dermatocosmiatría, cosmetología). Atiende por **WhatsApp**, vía GoHighLevel
  en modo coexistence.
- **Quiénes escriben:** cosmetólogas, cosmiatras y estudiantes del rubro. Casi
  todas mujeres, tuteo rioplatense, mensajes cortos y en ráfaga (el sistema los
  consolida con un debounce de ~60 segundos).
- **El equipo** atiende desde GoHighLevel. Cuando Valentina deriva, les llega
  un aviso al panel (módulo Derivaciones).
- **Sistemas externos:** GoHighLevel (CRM y WhatsApp), Tiendup (plataforma de
  cursos, solo para la masterclass de Higiene Facial), y las landings de cada
  evento.

## Reglas vigentes del bot (para no marcar como error lo que es correcto)

- **Se presenta SIEMPRE como IA.** "Valentina, la asistente IA de Vanesa Rúas
  Formación Profesional". Es decisión del cliente: no es un bug. Si alguien la
  confunde con Vanesa ("hola Vane"), tiene que aclararlo aunque la conversación
  ya venga empezada.
- **Usa emojis con moderación.** También decisión del cliente. No marcarlo.
- **La venta es autogestionada:** no deriva por interés de compra. Comparte la
  landing del evento vigente y recibe el comprobante.
- **Gate de título profesional:** a una contacta no registrada que manda
  comprobante se le retiene el pago hasta que acredite título o constancia de
  alumna del rubro.
- **Nunca dice CUÁNDO la va a contactar el equipo.** La fórmula autorizada es
  "a la brevedad", sin día ni hora.
- **Lo que no está en la base, se deriva.** No improvisa fechas, precios,
  logística ni reglas. Derivar no es un error: es el comportamiento correcto
  cuando el dato no está cargado.

### Eventos y su estado

- **Masterclass de Peelings de Verano** (28/11/2026, 16 a 21 hs, Zoom):
  **inscripciones ABIERTAS**, es la venta viva. Transferencia $110.000, tarjeta
  $150.000 en 3 cuotas, internacional USD 90. Cierre de inscripciones el
  25/11 a las 21 hs. Landing: peelings-de-verano-2026.vercel.app (ese link SÍ
  se comparte).
- **Skin Intellectuals Congress** (12-13/09/2026): ya se realizó.
- **Masterclass de Higiene Facial + Dermaplaning** (1/08/2026): ya se dictó y
  la grabación venció el 21/08. Si alguien pregunta, la respuesta es que ya no
  está disponible.

## Hechos de los sistemas externos que explican "errores" que no son del bot

- **La lectura de comprobantes con vision va directo a Anthropic**, no por
  OpenRouter. Viene fallando: buena parte de los comprobantes quedan con
  `amount` en null. Eso NO es culpa del agente conversacional, pero hace que el
  monto no se lea y que el match por monto caiga al evento por defecto.
- **El match comprobante → evento es por monto exacto** (hardcode en
  `src/lib/payments/event-match.ts`). Si el OCR no lee el monto, usa
  `DEFAULT_COMPROBANTE_EVENT_SLUG`, que tiene que apuntar a la venta abierta
  del momento. Hoy apunta a Peelings.
- **El botón "Dar acceso al curso"** solo está cableado a Tiendup para la
  masterclass de Higiene Facial (curso 519060). Para Peelings el acceso todavía
  es manual.
- **GoHighLevel** puede rebotar un envío si pasaron más de 24 horas desde el
  último mensaje del contacto. Eso aparece como "no se avisó al cliente" en
  Aprobaciones y no es un error del agente.

## Qué es crítico acá

1. **Decirle a alguien que acaba de pagar que no hay inscripciones abiertas**, o
   negar que un evento exista. Es el peor caso posible y ya pasó una vez.
2. **Dar un precio, una fecha o un monto equivocado.** Sobre todo si la persona
   toma una decisión con eso (cuánta plata llevar, qué día ir).
3. **Confirmar como oficial un dato que dijo la clienta.** Si alguien afirma una
   fecha o un precio, Valentina no se lo valida: lo chequea.
4. **Inventar que algo no existe** (ej. afirmar que un evento no tiene grupo de
   WhatsApp cuando sí lo tiene).
5. **Un comprobante sin responder**, o una persona que pagó y quedó esperando.
6. **Prometer un día u hora de contacto del equipo.**

## Estado del código

- Se despliega a Vercel desde `main` (proyecto `vaneruas`). El dominio asignado
  está detrás de Vercel Authentication, así que **no hay endpoint /api/health
  consultable**: para saber qué está desplegado, mirar `git log` contra lo que
  se pusheó.
- **Los prompts y la base de conocimiento** viven en
  `src/lib/agent/prompts/` y necesitan deploy.
- **La ficha de cada evento** (tabla `events`, módulo Eventos del panel) se lee
  en vivo en cada respuesta: se edita sin deploy. Es el canal para corregir en
  caliente durante un lanzamiento.
- Antes de pushear a producción se confirma con Federico.

## Privacidad

- Los insumos tienen nombres, teléfonos, correos y DNI de clientas reales.
  `informes/` va en `.gitignore` y nunca al repo. El informe se entrega solo en
  el chat, nunca como archivo ni artifact.
