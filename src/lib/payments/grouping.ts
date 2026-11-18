// ===========================================================================
// Agrupado de comprobantes: varias imágenes del MISMO pago = un solo ítem.
//
// Pasa seguido: la contacta manda 3 capturas de la misma transferencia (o el
// comprobante y una foto borrosa de lo mismo). Cada imagen entra como un job
// aparte y queda como un `payment_validations` pending propio. Sin agrupar, el
// equipo veía "Comprobante 3" y tenía que aprobar tres veces (y la persona
// recibía tres veces el aviso de pago aprobado).
//
// Regla:
//   - Se agrupan los PENDIENTES de la misma conversación y el mismo evento
//     (`event_slug`; si es null, los null de esa conversación van juntos).
//   - Si dentro de ese conjunto hay N° de operación leídos DISTINTOS, son pagos
//     distintos (hay quien paga en dos transferencias): un grupo por N° de
//     operación. Las imágenes sin N° leído se suman al grupo más viejo.
//   - Montos leídos distintos con el mismo N° (o sin N°) quedan en un grupo,
//     pero marcado `maybeDistinct` para que el panel avise "parecen pagos
//     distintos" (no se separan a ciegas: el OCR a veces lee mal el monto).
//   - Canónico (el que queda `validated` al aprobar): el más viejo con monto y
//     N° de operación leídos; si no hay, el más viejo con monto; si no, el más
//     viejo.
//
// Al aprobar el grupo, los demás quedan `rejected` con `mergedNote(canonico)`
// (ver dismiss.ts): sin cambio de esquema (el CHECK de status solo admite
// pending/validated/rejected), y excluidos de métricas, ficha y listas como
// los descartados.
//
// Sin "server-only": lo usan las rutas y los tests de scripts/.
// ===========================================================================

export interface GroupablePayment {
  id: string;
  conversation_id: string | null;
  event_slug: string | null;
  status: string;
  amount: number | string | null;
  operation_number: string | null;
  created_at: string;
}

export interface PaymentGroup<T extends GroupablePayment> {
  /** Clave estable del grupo (conversación + evento + N° de operación). */
  key: string;
  /** El que se aprueba (validated) en nombre de todos. */
  canonical: T;
  /** Todos los miembros, del más viejo al más nuevo (incluye al canónico). */
  members: T[];
  /** Montos leídos distintos dentro del grupo: puede que no sean el mismo pago. */
  maybeDistinct: boolean;
}

/** N° de operación comparable ("" = no leído). */
export function normalizeOperation(op: string | null | undefined): string {
  return (op ?? "").replace(/\s+/g, "").toUpperCase();
}

function hasAmount(p: GroupablePayment): boolean {
  return p.amount !== null && p.amount !== undefined && p.amount !== "";
}

function byCreated<T extends GroupablePayment>(a: T, b: T): number {
  if (a.created_at === b.created_at) return a.id.localeCompare(b.id);
  return a.created_at < b.created_at ? -1 : 1;
}

/** Elige el canónico de un conjunto (ver criterio arriba). */
export function pickCanonical<T extends GroupablePayment>(members: T[]): T {
  const sorted = members.slice().sort(byCreated);
  return (
    sorted.find((p) => hasAmount(p) && normalizeOperation(p.operation_number)) ??
    sorted.find(hasAmount) ??
    sorted[0]!
  );
}

function baseKey(p: GroupablePayment): string {
  return `${p.conversation_id ?? `sin-conv:${p.id}`}|${p.event_slug ?? ""}`;
}

/**
 * Agrupa los comprobantes PENDIENTES. Las filas que no están pending se
 * ignoran. Devuelve los grupos ordenados por el miembro más viejo.
 */
export function groupPendingPayments<T extends GroupablePayment>(rows: T[]): PaymentGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    if (r.status !== "pending") continue;
    const k = baseKey(r);
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }

  const groups: PaymentGroup<T>[] = [];
  for (const [k, list] of buckets) {
    const sorted = list.slice().sort(byCreated);
    // Sub-grupos por N° de operación leído, en orden de aparición.
    const byOp = new Map<string, T[]>();
    const sinOp: T[] = [];
    for (const p of sorted) {
      const op = normalizeOperation(p.operation_number);
      if (!op) {
        sinOp.push(p);
        continue;
      }
      const arr = byOp.get(op) ?? [];
      arr.push(p);
      byOp.set(op, arr);
    }

    const parts: { op: string; members: T[] }[] = [...byOp].map(([op, members]) => ({ op, members }));
    if (!parts.length) {
      parts.push({ op: "", members: sinOp });
    } else if (sinOp.length) {
      // Las imágenes sin N° leído van con el pago más viejo.
      const oldest = parts.reduce((a, b) => (byCreated(a.members[0]!, b.members[0]!) <= 0 ? a : b));
      oldest.members.push(...sinOp);
      oldest.members.sort(byCreated);
    }

    for (const part of parts) {
      const amounts = new Set(
        part.members.filter(hasAmount).map((p) => Number(p.amount)),
      );
      groups.push({
        key: part.op ? `${k}|${part.op}` : k,
        canonical: pickCanonical(part.members),
        members: part.members,
        maybeDistinct: amounts.size > 1,
      });
    }
  }

  return groups.sort((a, b) => byCreated(a.members[0]!, b.members[0]!));
}

/** Grupo pendiente que contiene a este comprobante (o null si no está pending). */
export function findGroupOf<T extends GroupablePayment>(rows: T[], id: string): PaymentGroup<T> | null {
  return groupPendingPayments(rows).find((g) => g.members.some((m) => m.id === id)) ?? null;
}
