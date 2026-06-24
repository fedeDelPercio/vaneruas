// Verificación del DESTINATARIO de un comprobante. PURA (sin server-only),
// testeable. La cuenta legítima es la de Vanesa Rúas; si el nombre o el CUIT del
// destinatario que leyó el OCR no coinciden, lo marcamos en Aprobaciones para
// que el equipo verifique antes de aprobar (transferencia a otra cuenta, captura
// de otra persona, o comprobante falso).
//
// Hardcode por-cliente (como event-match.ts). Si cambia la cuenta, se edita acá.

const EXPECTED_RECIPIENT_CUIT = "27284222488"; // 27-28422248-8
// Tokens que SIEMPRE aparecen en el nombre legítimo (en cualquier variante:
// "VANESA CINTIA RUAS", "PAYPAL *VANESA RUAS", "NPVANESARUAS"). Deben estar los dos.
const EXPECTED_NAME_TOKENS = ["vanesa", "ruas"] as const;

/** minúsculas, sin acentos, solo letras y números (saca espacios y símbolos). */
function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** solo los dígitos. */
function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

export type RecipientMismatch = "nombre" | "cuit";

/**
 * Devuelve los campos del destinatario que NO coinciden con la cuenta legítima.
 * `[]` = todo OK (o no hay datos suficientes para dudar). Solo marca un campo
 * como mismatch si está presente y es claramente distinto: un dato nulo o un
 * CUIT enmascarado (ej. "****42224**") NO cuenta como mismatch (no se puede
 * verificar, no inventamos una alerta).
 */
export function recipientMismatches(
  name: string | null | undefined,
  taxId: string | null | undefined,
): RecipientMismatch[] {
  const out: RecipientMismatch[] = [];

  if (name && name.trim()) {
    const n = normName(name);
    const ok = EXPECTED_NAME_TOKENS.every((t) => n.includes(t));
    if (!ok) out.push("nombre");
  }

  if (taxId && taxId.trim()) {
    const masked = /[*xX]/.test(taxId); // CUIT parcialmente oculto (ej. "****42224**")
    const digits = digitsOf(taxId);
    // Solo comparamos un CUIT completo (11 dígitos) y sin enmascarar.
    if (!masked && digits.length === 11 && digits !== EXPECTED_RECIPIENT_CUIT) {
      out.push("cuit");
    }
  }

  return out;
}
