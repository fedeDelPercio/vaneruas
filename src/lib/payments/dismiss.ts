// Descartados: imágenes que llegaron a Aprobaciones y NO eran un comprobante
// (capturas de pantalla, títulos sueltos, fotos al voleo).
//
// Por qué importa: en la base, descartar y rechazar terminan igual
// (status="rejected"), pero significan cosas opuestas. Rechazar es "este pago
// no sirve"; descartar es "esto nunca fue un pago". Mezclarlos hundía el
// indicador de comprobantes confirmados: con 260 imágenes recibidas y 114
// rechazadas, el panel mostraba 56% confirmados y se leía como que el 44% de
// los pagos había fallado, cuando 93 de esas 114 ni siquiera tenían monto.

/** Nota que deja el botón de descartar del panel. */
export const DISMISS_NOTE =
  "Descartado por el equipo: la imagen no era un comprobante ni un título";

export interface DismissableRow {
  status: string;
  validation_note?: string | null;
  amount?: number | string | null;
}

/**
 * ¿Esta fila rechazada es en realidad un descarte?
 *
 * Dos señales: la nota explícita del botón de descartar, o que la lectura con
 * vision no haya sacado NINGÚN monto. Lo segundo es una aproximación aceptada
 * para el histórico (el botón de descartar es nuevo y el equipo venía usando
 * "Rechazar" para todo): un comprobante real casi siempre deja monto, y si no
 * lo deja, no hay nada que confirmar.
 */
export function esDescartado(row: DismissableRow): boolean {
  if (row.status !== "rejected") return false;
  // Una imagen agrupada no es un descarte (ver esAgrupado): sale de las cuentas
  // por su lado, aunque no tenga monto leído.
  if (esAgrupado(row)) return false;
  if (row.validation_note === DISMISS_NOTE) return true;
  return row.amount === null || row.amount === undefined;
}

// ---------------------------------------------------------------------------
// Agrupados: imágenes extra del MISMO pago (ver grouping.ts). Al aprobar el
// grupo, el canónico queda `validated` y los demás `rejected` con esta nota
// (sin cambio de esquema: el CHECK de status no admite otro valor). No son un
// rechazo: no se avisan por WhatsApp, no cuentan en métricas, no aparecen como
// "rechazado" en la ficha ni en las listas (se muestran como imágenes del
// canónico).

/** Prefijo de la nota de agrupado. */
export const MERGED_NOTE_PREFIX = "Agrupado con el comprobante ";

/** Nota que se deja en cada imagen extra al resolver el grupo. */
export function mergedNote(canonicalId: string): string {
  return `${MERGED_NOTE_PREFIX}${canonicalId}`;
}

/** ¿Esta fila es una imagen extra agrupada con otro comprobante? */
export function esAgrupado(row: { status: string; validation_note?: string | null }): boolean {
  return row.status === "rejected" && (row.validation_note ?? "").startsWith(MERGED_NOTE_PREFIX);
}

/** Id del canónico de una fila agrupada (o null si no lo es). */
export function canonicoDeAgrupado(row: { status: string; validation_note?: string | null }): string | null {
  if (!esAgrupado(row)) return null;
  const id = (row.validation_note ?? "").slice(MERGED_NOTE_PREFIX.length).trim();
  return id || null;
}
