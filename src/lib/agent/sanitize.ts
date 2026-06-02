// ===========================================================================
// Sanitización de estilo determinística para mensajería.
//
// Las reglas de formato base del agente (sin emojis, sin signos de apertura
// ¿/¡, sin markdown bold, sin em dash, sin punto final) son DETERMINÍSTICAS:
// se resuelven con string ops, no necesitan criterio. Antes vivían como
// criterios BLOQUEANTES del evaluator (LLM), lo que causaba dos problemas:
//   1. Falsos positivos: el modelo chico (Haiku) "alucinaba" un `¿` que no
//      estaba y rechazaba la respuesta. Tras 3 rechazos, la conversación se
//      derivaba al equipo (fuera_de_conocimiento) aunque la respuesta fuera
//      correcta — un simple "hola" terminaba escalado.
//   2. Costo: cada rechazo dispara una regeneración (~17k tokens). Un loop
//      de 3 = ~51k tokens por un saludo.
//
// Al sanitizar en código, el estilo queda garantizado al 100% y el evaluator
// se enfoca solo en lo que SÍ requiere criterio (grounding, identidad,
// coherencia, meta-comentarios, tono imperativo).
//
// Si tu cliente NECESITA emojis / `¿¡` / punto final por algún motivo,
// ajustá las reglas acá; idem si querés agregar otras (links, capitalize,
// etc.). El resto del sistema sigue funcionando igual.
// ===========================================================================

// Rango de emojis comunes (pictogramas, emoticons, simbolos, dingbats,
// banderas, variation selectors y ZWJ para emojis compuestos). No incluye
// flechas Unicode basicas (←-⇿) para no romper texto legitimo.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu;

/** Quita el punto final de un bloque (respeta la elipsis "..."). */
function stripTrailingPeriod(block: string): string {
  const t = block.replace(/[ \t]+$/g, "");
  if (t.endsWith("...")) return t; // elipsis: se permite
  if (t.endsWith(".")) return t.slice(0, -1).replace(/[ \t]+$/g, "");
  return t;
}

/**
 * Aplica las reglas de estilo a la respuesta del orquestador.
 * Idempotente: correrla dos veces da el mismo resultado.
 */
export function sanitizeStyle(text: string): string {
  let out = text;

  // 1. Markdown: **bold** y *cursiva* -> texto plano.
  out = out.replace(/\*\*(.+?)\*\*/gs, "$1").replace(/\*(.+?)\*/gs, "$1");

  // 2. Em dash -> coma (la regla del repo: coma, punto o middot).
  out = out.replace(/\s*—\s*/g, ", ");

  // 3. Emojis -> fuera.
  out = out.replace(EMOJI_RE, "");

  // 4. Signos de apertura -> fuera (solo se usan los de cierre ? !).
  out = out.replace(/[¿¡]/g, "");

  // 5. Punto final por bloque. Los mensajes multi-bloque se separan con una
  //    linea "---"; controlamos el ultimo caracter de cada bloque.
  out = out
    .split(/\n---\n/)
    .map((block) => {
      // Conservamos saltos internos: solo tocamos el cierre del bloque.
      const trimmedEnd = block.replace(/\s+$/g, "");
      const leadingWs = block.slice(0, block.length - block.trimStart().length);
      const stripped = stripTrailingPeriod(trimmedEnd.trimStart());
      return leadingWs + stripped;
    })
    .join("\n---\n");

  // 6. Limpiar espacios dobles que pudieron quedar al remover emojis.
  out = out.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n");

  return out.trim();
}
