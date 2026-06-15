// ===========================================================================
// Helpers de formato de eventos. PUROS (sin server-only ni DOM), reusables
// tanto desde el loader de KB del agente (server) como desde el panel (client).
// Single source of truth para labels de tipo/estado y formato de precios, así
// el panel y lo que ve el agente hablan el mismo idioma.
// ===========================================================================

export type EventKind = "masterclass" | "congress";
export type EventStatus = "borrador" | "activo" | "archivado";

export const KIND_LABEL: Record<string, string> = {
  masterclass: "Masterclass",
  congress: "Congreso",
};

export const STATUS_LABEL: Record<string, string> = {
  borrador: "Borrador",
  activo: "Activo",
  archivado: "Archivado",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const USD = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatARS(n: number): string {
  return ARS.format(n);
}

export function formatUSD(n: number): string {
  return `USD ${USD.format(n).replace(/^US\$\s?/, "")}`;
}

/** Monto por cuota calculado: total / cuotas. Null si falta alguno. */
export function installmentAmount(
  total: number | null,
  installments: number | null,
): number | null {
  if (!total || !installments || installments < 1) return null;
  return total / installments;
}

/**
 * Precio con tarjeta como "$Total (N cuotas de $X)". El monto por cuota se
 * calcula solo (total / cuotas). Si no hay cuotas (o es 1), muestra solo el
 * total. Devuelve null si no hay total.
 */
export function cardPriceLabel(
  total: number | null,
  installments: number | null,
): string | null {
  if (total == null) return null;
  const per = installmentAmount(total, installments);
  if (per == null || (installments ?? 0) <= 1) {
    return formatARS(total);
  }
  return `${formatARS(total)} (${installments} cuotas de ${formatARS(per)})`;
}

export function transferPriceLabel(price: number | null): string | null {
  if (price == null) return null;
  return formatARS(price);
}

export function internationalPriceLabel(price: number | null): string | null {
  if (price == null) return null;
  return formatUSD(price);
}
