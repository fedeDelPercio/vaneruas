import { accesoVigenteDeEvento, eventBySlug } from "./event-match";
import { DISMISS_NOTE } from "./dismiss";

export function needsCourseAccess(slug: string | null, status: string, grantedAt: string | null) {
  const event = eventBySlug(slug);
  return Boolean(event && event.slug !== "congreso" && accesoVigenteDeEvento(slug) &&
    status === "validated" && !grantedAt);
}

export const paymentStatusChip = {
  pending: { label: "Pendiente", tone: "warn" },
  validated: { label: "Aprobado", tone: "ok" },
  rejected: { label: "Rechazado", tone: "bad" },
} as const;

export const titleChips = {
  valid: { label: "Ya entregado", tone: "ok" },
  review: { label: "Pendiente de revisión", tone: "warn" },
  rejected: { label: "Rechazado", tone: "bad" },
  // Registrada sin archivo: el equipo lo quiere ver igual que un título entregado.
  exempt: { label: "Ya entregado", tone: "ok", detail: "alumna registrada" },
  none: { label: "No enviado", tone: "neutral" },
} as const;

type Title = { hasFile: boolean; isValid: boolean; reviewedAt: string | null };

export function titleState(titles: Title[], exempt: boolean): keyof typeof titleChips {
  if (titles.some((t) => t.isValid)) return "valid";
  if (titles.some((t) => t.hasFile && !t.reviewedAt)) return "review";
  if (titles.some((t) => t.reviewedAt)) return "rejected";
  return exempt ? "exempt" : "none";
}

// El gate exime a la contacta registrada. Un archivo cuenta como entregado
// con cualquier veredicto, aunque su URL firmada no esté disponible.
export function titleDelivered(titles: Title[], exempt: boolean) {
  return exempt || titles.some((t) => t.hasFile);
}

export function eventTitle(slug: string | null) {
  return eventBySlug(slug)?.label.replace(/^Masterclass\s+/i, "") ?? null;
}

type Receipt = {
  id: string;
  event_slug: string | null;
  created_at: string;
  transferred_at: string | null;
  operation_number: string | null;
  validation_note: string | null;
  status: string;
};

const receiptMonth = new Intl.DateTimeFormat("es-AR", { month: "short", year: "numeric", timeZone: "UTC" });
const receivedMonth = new Intl.DateTimeFormat("es-AR", {
  month: "short", year: "numeric", timeZone: "America/Argentina/Buenos_Aires",
});
// La hora extraída del comprobante se guarda como hora local en UTC.
const receiptTime = (receipt: Receipt) => receipt.transferred_at
  ? Date.parse(receipt.transferred_at) + 3 * 60 * 60 * 1000
  : Date.parse(receipt.created_at);
const operation = (receipt: Receipt) => receipt.operation_number?.trim().toUpperCase();

export function previousMasterclasses(current: Receipt, history: Receipt[], groupedIds: ReadonlySet<string>) {
  const currentOp = operation(current);
  const currentTime = receiptTime(current);
  const seenOperations = new Set<string>();
  const candidates = history.flatMap((receipt) => {
    const event = eventBySlug(receipt.event_slug);
    const time = receiptTime(receipt);
    const op = operation(receipt);
    if (receipt.status !== "validated" || !event || event.slug === "congreso" || !Number.isFinite(time) ||
        receipt.id === current.id || groupedIds.has(receipt.id) ||
        receipt.validation_note === DISMISS_NOTE || (op && (op === currentOp || seenOperations.has(op)))) return [];
    if (op) seenOperations.add(op);
    if (receipt.event_slug === current.event_slug && !(time < currentTime)) return [];
    const month = receipt.transferred_at ? receiptMonth : receivedMonth;
    return [{ event, time, date: month.formatToParts(receipt.transferred_at ? Date.parse(receipt.transferred_at) : time) }];
  });
  return [...new Set(candidates.sort((a, b) => b.time - a.time).map(({ event, date }) =>
    `${event.shortLabel} · ${date
      .filter(({ type }) => type === "month" || type === "year")
      .map(({ value }) => value.replace(/\./g, "")).join(" ")}`.toLocaleUpperCase("es-AR"),
  ))];
}
