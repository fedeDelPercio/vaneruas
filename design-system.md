# Design System — Vanesa Rúas
> Fuente de verdad visual para todos los productos digitales de la marca.  
> Este documento está escrito para ser pegado como contexto en cualquier sesión de IA
> (Claude Code, Cursor, v0, etc.) que necesite construir o replicar el frontend.

---

## 1. Principio general

El sistema visual de Vanesa Rúas comunica **autoridad profesional + calidez cercana**.  
No es un diseño de influencer ni de spa de lujo. Es el visual de una líder de comunidad que
enseña desde la experiencia: **oscuridad como contenedor, oro como premio, blanco como claridad**.

Toda pantalla, tarjeta o componente debe poder describirse con esta fórmula:
> fondo oscuro · texto blanco limpio · acento dorado · tipografía Poppins

---

## 2. Tipografía

**Fuente única: Poppins** (Google Fonts)  
Importar siempre con los pesos: 400, 500, 600, 700, 800.

```css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');

:root {
  --font-base: 'Poppins', sans-serif;
}
```

### Escala tipográfica

| Token | Tamaño | Peso | Uso |
|-------|--------|------|-----|
| `--text-display` | 48–64px | 800 | Títulos de portada / hero |
| `--text-h1` | 36–40px | 700 | Títulos de sección principales |
| `--text-h2` | 28–32px | 700 | Subtítulos de sección |
| `--text-h3` | 22–24px | 600 | Títulos de tarjetas / módulos |
| `--text-body-lg` | 18px | 400 | Cuerpo de texto largo |
| `--text-body` | 16px | 400 | Cuerpo estándar |
| `--text-sm` | 14px | 400 | Notas, labels, metadata |
| `--text-xs` | 12px | 500 | Badges, etiquetas pequeñas |

### Reglas tipográficas

- **Nunca usar** serif, system-ui ni fuentes de sistema como fuente principal.
- **Interlineado (line-height):** 1.5 para cuerpo, 1.15 para títulos.
- **Letter-spacing:** 0 para cuerpo; `0.02em` para labels y badges en mayúsculas.
- **Solo Poppins** en toda la jerarquía: headings, body, labels, botones.

---

## 3. Paleta de colores

### 3.1 Colores base (constantes — nunca cambian)

```css
:root {
  /* Fondos */
  --color-bg-primary:    #0a0a0a;   /* Negro principal — fondo de toda la app */
  --color-bg-card:       #111111;   /* Cajas / tarjetas oscuras */
  --color-bg-elevated:   #1a1a1a;   /* Elementos elevados: modales, dropdowns */
  --color-bg-subtle:     #222222;   /* Inputs, separadores, hover states */

  /* Texto */
  --color-text-primary:  #ffffff;   /* Texto principal */
  --color-text-secondary:#b0b0b0;   /* Texto secundario / metadata */
  --color-text-muted:    #666666;   /* Texto desactivado / placeholder */

  /* Bordes */
  --color-border:        #2a2a2a;   /* Bordes de tarjetas e inputs */
  --color-border-subtle: #1e1e1e;   /* Divisores muy sutiles */

  /* Dorado — el color premium de la marca */
  --color-gold-start:    #ffff7f;   /* Inicio del degradado (top) */
  --color-gold-end:      #f9a900;   /* Fin del degradado (bottom) */
  --color-gold-solid:    #f9a900;   /* Dorado sólido para fondos o bordes */
  --color-gold-glow:     rgba(249, 169, 0, 0.35); /* Glow alrededor del dorado */

  /* Estados */
  --color-success:       #22c55e;
  --color-warning:       #f59e0b;
  --color-error:         #ef4444;
  --color-info:          #3b82f6;
}
```

### 3.2 Color temático por evento (variable — cambia por evento)

Cada evento de Vane tiene su propio color temático. Se inyecta como variable CSS al cargar el evento:

```css
/* Ejemplo: congreso con color azul eléctrico */
:root {
  --color-event:         #4f46e5;
  --color-event-muted:   rgba(79, 70, 229, 0.15);
  --color-event-border:  rgba(79, 70, 229, 0.4);
}

/* Ejemplo: masterclass con color verde esmeralda */
:root {
  --color-event:         #059669;
  --color-event-muted:   rgba(5, 150, 105, 0.15);
  --color-event-border:  rgba(5, 150, 105, 0.4);
}
```

**Uso del color de evento:**
- Badges y etiquetas del tipo de formación
- Borde o acento de la tarjeta del evento activo
- Indicador de estado / progreso
- Nunca como fondo principal, nunca en texto largo

---

## 4. El dorado — reglas de uso

El degradado dorado es el elemento premium más importante de la marca. Usarlo con criterio.

### CSS del degradado de texto (el uso más frecuente)

```css
.text-gold {
  background: linear-gradient(180deg, #ffff7f 0%, #f9a900 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
}
```

### CSS del glow (solo sobre texto blanco, nunca sobre el dorado)

```css
.text-glow {
  color: #ffffff;
  text-shadow:
    0 0 20px rgba(255, 255, 255, 0.8),
    0 0 40px rgba(255, 255, 255, 0.4),
    0 0 60px rgba(255, 255, 255, 0.2);
}
```

### CSS del glow dorado (para bordes o sombras de elementos, no texto)

```css
.glow-gold {
  box-shadow:
    0 0 20px rgba(249, 169, 0, 0.35),
    0 0 40px rgba(249, 169, 0, 0.15);
}
```

### Reglas de uso del dorado

| ✅ Usar en | ❌ Nunca usar en |
|------------|-----------------|
| Palabras clave en títulos (1–4 palabras) | Texto de cuerpo largo |
| Títulos de portada del evento | Botones primarios de acción |
| Precio o cifra destacada | Fondos extensos |
| Premio / cierre / CTA de copy | Sobre fondo blanco o claro |
| Badges de "premium" o "exclusivo" | Combinado con glow al mismo tiempo |

---

## 5. Efectos visuales

### Glassmorphism (para modales y elementos flotantes)

```css
.glass {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

### Tarjeta oscura estándar

```css
.card {
  background: #111111;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 24px;
}

/* Hover state */
.card:hover {
  border-color: rgba(249, 169, 0, 0.3);
  box-shadow: 0 0 20px rgba(249, 169, 0, 0.08);
  transition: all 0.2s ease;
}
```

### Gradiente de fondo sutil (para secciones hero o encabezados)

```css
.hero-bg {
  background:
    radial-gradient(ellipse at 20% 50%, rgba(249, 169, 0, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(249, 169, 0, 0.04) 0%, transparent 40%),
    #0a0a0a;
}
```

---

## 6. Componentes UI

### 6.1 Botones

```css
/* Botón primario — dorado sobre negro */
.btn-primary {
  background: linear-gradient(135deg, #f9a900 0%, #ffff7f 100%);
  color: #000000;
  font-family: 'Poppins', sans-serif;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.02em;
  padding: 12px 24px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(249, 169, 0, 0.4);
}

/* Botón secundario — contorno dorado */
.btn-secondary {
  background: transparent;
  color: #f9a900;
  font-family: 'Poppins', sans-serif;
  font-weight: 600;
  font-size: 14px;
  padding: 11px 23px;
  border-radius: 8px;
  border: 1px solid rgba(249, 169, 0, 0.5);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: rgba(249, 169, 0, 0.08);
  border-color: #f9a900;
}

/* Botón ghost — texto blanco, borde sutil */
.btn-ghost {
  background: transparent;
  color: #ffffff;
  font-family: 'Poppins', sans-serif;
  font-weight: 500;
  font-size: 14px;
  padding: 11px 23px;
  border-radius: 8px;
  border: 1px solid #2a2a2a;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-ghost:hover {
  background: #1a1a1a;
  border-color: #3a3a3a;
}

/* Estado deshabilitado (aplica a todos) */
.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
```

### 6.2 Inputs y formularios

```css
.input {
  background: #111111;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  color: #ffffff;
  font-family: 'Poppins', sans-serif;
  font-size: 15px;
  padding: 12px 16px;
  width: 100%;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.input::placeholder {
  color: #555555;
}

.input:focus {
  border-color: rgba(249, 169, 0, 0.6);
  box-shadow: 0 0 0 3px rgba(249, 169, 0, 0.1);
}

.input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Label */
.label {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #b0b0b0;
  margin-bottom: 6px;
  display: block;
}

/* Mensaje de error */
.input-error {
  border-color: rgba(239, 68, 68, 0.6);
}

.error-message {
  font-size: 12px;
  color: #ef4444;
  margin-top: 4px;
}
```

### 6.3 Badges y etiquetas

```css
/* Badge base */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 100px;
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Dorado — para "Premium", "Exclusivo", tipo de formación destacado */
.badge-gold {
  background: rgba(249, 169, 0, 0.12);
  color: #f9a900;
  border: 1px solid rgba(249, 169, 0, 0.3);
}

/* Blanco — neutro */
.badge-white {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

/* Color de evento (usa var) */
.badge-event {
  background: var(--color-event-muted);
  color: var(--color-event);
  border: 1px solid var(--color-event-border);
}

/* Estado: activo, aprobado */
.badge-success {
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

/* Estado: pendiente */
.badge-warning {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}
```

### 6.4 Separadores

```css
.divider {
  border: none;
  border-top: 1px solid #1e1e1e;
  margin: 24px 0;
}

/* Separador con acento dorado */
.divider-gold {
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(249, 169, 0, 0.4), transparent);
  margin: 24px 0;
}
```

---

## 7. Espaciado y layout

### Escala de espaciado (múltiplos de 4)

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
}
```

### Border radius

```css
:root {
  --radius-sm:   6px;   /* Inputs pequeños, badges */
  --radius-md:   8px;   /* Inputs estándar, botones */
  --radius-lg:  12px;   /* Tarjetas */
  --radius-xl:  16px;   /* Modales, panels */
  --radius-2xl: 24px;   /* Contenedores grandes */
  --radius-full: 9999px; /* Pills y círculos */
}
```

### Contenedor máximo

```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
}

/* Uso interno (dashboard, wizard) */
.container-narrow {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 24px;
}
```

---

## 8. Patrones de componente compuesto

### 8.1 Tarjeta de evento

```
┌─────────────────────────────────────────────┐
│  [Badge: tipo de evento]    [Badge: estado]  │
│                                              │
│  Nombre del evento                           │  ← h3, blanco, Poppins 700
│  Técnica central                             │  ← body, #b0b0b0
│                                              │
│  ── ── ── ── ── ── ── ── ── ── ── ── ──     │  ← divider #1e1e1e
│                                              │
│  📅 Fecha       ⏱ Duración      💰 Precio   │  ← texto sm, íconos lineales
│                                              │
│  [Btn secundario: Ver]   [Btn primario: Generar]  │
└─────────────────────────────────────────────┘
  background: #111111 · border: 1px solid #2a2a2a · border-radius: 12px
```

### 8.2 Wizard / formulario de onboarding

El wizard usa una estructura de pasos horizontales fija:

```
[ Paso 1 ] ──── [ Paso 2 ] ──── [ Paso 3 ] ──── [ Paso 4 ]
  (activo)       (pendiente)     (pendiente)     (pendiente)
```

- Paso activo: número en círculo dorado (`background: #f9a900; color: #000`)
- Paso completado: check blanco en círculo con borde dorado
- Paso pendiente: número en círculo oscuro (`background: #222; color: #666; border: #2a2a2a`)
- Línea conectora: `1px solid #2a2a2a` → cambia a `#f9a900` cuando el paso anterior está completo

### 8.3 Tarjeta de entregable generado

```
┌─────────────────────────────────────────────┐
│  [Badge tipo: "Copy Instagram"]  [✓ Aprobado]│
│                                              │
│  Contenido generado...                       │  ← body blanco
│  (scrolleable si es largo)                   │
│                                              │
│  ── ── ── ── ── ── ── ── ── ── ── ── ──     │
│                                              │
│  [Btn ghost: Editar]  [Btn ghost: Copiar]  [Btn primario: Aprobar] │
└─────────────────────────────────────────────┘
```

---

## 9. Iconografía

- **Librería:** Flaticon — estilo "Especial Lineal" (stroke icons, no filled)
- **Alternativa de código:** [Lucide React](https://lucide.dev/) para íconos de UI (mismo estilo lineal)
- **Tamaños estándar:** 16px · 20px · 24px · 32px
- **Color:** hereda del texto (`currentColor`)
- **Nunca:** íconos filled/sólidos, emojis como íconos de UI, íconos de distintas familias mezclados

```jsx
// Ejemplo con Lucide en React
import { Calendar, Clock, CheckCircle, Copy } from 'lucide-react'

<Calendar size={20} className="text-gold" />
<CheckCircle size={16} className="text-success" />
```

---

## 10. Formatos de contenido especiales

### Carrusel de Instagram (referencia para mockups)

- Formato: **1080 × 1350 px** (4:5 vertical)
- Fondo: caja oscura (`#0a0a0a` o textura oscura, según el evento)
- Tipografía: Poppins exclusivamente
- Texto base: blanco · énfasis: blanco + glow · premium: degradado dorado
- El glow nunca va sobre texto dorado: solo sobre blanco
- Slides: portada · emocional · CTA+info · testimonios · temario · (speakers solo en congreso) · lo que incluye · métodos de pago

---

## 11. Modo oscuro como base (no hay modo claro)

El sistema **no tiene modo claro**. El fondo es siempre oscuro.  
No implementar toggle de tema. Si una plataforma fuerza modo claro, ignorarla con:

```css
:root {
  color-scheme: dark;
}
```

---

## 12. Tokens CSS completos (copiar al inicio de cualquier proyecto)

```css
/* =============================================
   DESIGN SYSTEM — VANESA RÚAS
   Copiá este bloque al :root de tu proyecto
   ============================================= */

@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');

:root {
  /* Tipografía */
  --font-base: 'Poppins', sans-serif;

  /* Escala de texto */
  --text-display: clamp(40px, 5vw, 64px);
  --text-h1:      clamp(28px, 3vw, 40px);
  --text-h2:      clamp(22px, 2.5vw, 32px);
  --text-h3:      clamp(18px, 2vw, 24px);
  --text-body-lg: 18px;
  --text-body:    16px;
  --text-sm:      14px;
  --text-xs:      12px;

  /* Fondos */
  --color-bg-primary:    #0a0a0a;
  --color-bg-card:       #111111;
  --color-bg-elevated:   #1a1a1a;
  --color-bg-subtle:     #222222;

  /* Texto */
  --color-text-primary:  #ffffff;
  --color-text-secondary:#b0b0b0;
  --color-text-muted:    #666666;

  /* Bordes */
  --color-border:        #2a2a2a;
  --color-border-subtle: #1e1e1e;

  /* Dorado */
  --color-gold-start:    #ffff7f;
  --color-gold-end:      #f9a900;
  --color-gold-solid:    #f9a900;
  --color-gold-glow:     rgba(249, 169, 0, 0.35);

  /* Color de evento (sobreescribir por evento) */
  --color-event:         #f9a900;
  --color-event-muted:   rgba(249, 169, 0, 0.12);
  --color-event-border:  rgba(249, 169, 0, 0.3);

  /* Estados */
  --color-success:       #22c55e;
  --color-warning:       #f59e0b;
  --color-error:         #ef4444;
  --color-info:          #3b82f6;

  /* Espaciado */
  --space-1:   4px;
  --space-2:   8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;

  /* Border radius */
  --radius-sm:   6px;
  --radius-md:   8px;
  --radius-lg:  12px;
  --radius-xl:  16px;
  --radius-2xl: 24px;
  --radius-full: 9999px;

  /* Sombras */
  --shadow-card:   0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.6);
  --shadow-modal:  0 20px 60px rgba(0,0,0,0.8);
  --shadow-gold:   0 0 20px rgba(249,169,0,0.35), 0 0 40px rgba(249,169,0,0.15);
  --shadow-glow:   0 0 20px rgba(255,255,255,0.8), 0 0 40px rgba(255,255,255,0.4);

  /* Transiciones */
  --transition-fast:   0.1s ease;
  --transition-base:   0.2s ease;
  --transition-slow:   0.3s ease;

  /* Z-index */
  --z-base:    0;
  --z-raised:  10;
  --z-overlay: 100;
  --z-modal:   200;
  --z-toast:   300;

  color-scheme: dark;
}

/* Reset base */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-base);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* Utilidades dorado */
.text-gold {
  background: linear-gradient(180deg, var(--color-gold-start) 0%, var(--color-gold-end) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
}

.text-glow {
  color: #ffffff;
  text-shadow: 0 0 20px rgba(255,255,255,0.8), 0 0 40px rgba(255,255,255,0.4);
}
```

---

## 13. Prompt para IA — cómo usar este documento

Cuando vayas a pedirle a una IA que construya una pantalla o componente para cualquier producto de Vanesa Rúas, pegá este bloque al inicio del mensaje:

```
Usá el design system de Vanesa Rúas:
- Fuente: Poppins (400/500/600/700/800) — Google Fonts
- Fondo principal: #0a0a0a · Tarjetas: #111111 · Elevated: #1a1a1a
- Texto: #ffffff (primario) · #b0b0b0 (secundario) · #666666 (muted)
- Bordes: #2a2a2a
- Dorado (texto premium): background: linear-gradient(180deg, #ffff7f 0%, #f9a900 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
- Glow (solo sobre texto blanco): text-shadow: 0 0 20px rgba(255,255,255,0.8), 0 0 40px rgba(255,255,255,0.4);
- Botón primario: fondo dorado, texto negro, Poppins 700
- Botón secundario: borde dorado, texto dorado, fondo transparente
- Badges: border-radius 9999px, uppercase, letra pequeña (11-12px)
- Íconos: estilo lineal (Lucide React o similar). Nunca filled.
- NO hay modo claro. El fondo siempre es oscuro.
- El color de evento es una variable CSS --color-event que cambia por evento.
```

---

## 14. Checklist antes de entregar cualquier pantalla

- [ ] ¿La fuente es Poppins en todos los elementos?
- [ ] ¿El fondo es oscuro (`#0a0a0a` o `#111111`)?
- [ ] ¿El texto base es blanco (`#ffffff`)?
- [ ] ¿El dorado se usó con criterio (máximo 1–3 palabras por bloque, nunca en texto largo)?
- [ ] ¿El glow está solo sobre texto blanco, nunca sobre el dorado?
- [ ] ¿Los íconos son de estilo lineal?
- [ ] ¿Los badges tienen `border-radius: 9999px` y texto en `uppercase`?
- [ ] ¿Los botones primarios tienen texto negro sobre fondo dorado?
- [ ] ¿Hay un color de evento inyectado como variable CSS?
- [ ] ¿La jerarquía tipográfica es clara (display > h1 > h2 > h3 > body > sm)?
