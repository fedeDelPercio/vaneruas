import { eventBySlug } from "./event-match";
import { titleState } from "./revision-card";

export type StepStatus = "done" | "current" | "future" | "error";
type TitleState = ReturnType<typeof titleState>;
type Action = "reviewTitle" | "force" | "approve" | "reject" | "grant" | "mark" | "email";

export interface CardStep {
  key: "title" | "receipt" | "payment" | "access";
  label: string;
  status: StepStatus;
  detail: string;
  actions?: Action[];
}

interface CardPayment {
  status: "pending" | "validated" | "rejected";
  titles: { hasFile: boolean; isValid: boolean; reviewedAt: string | null }[];
  titleExempt: boolean;
  awaitingTitle: boolean;
  createdAt: string;
  validatedAt: string | null;
  eventSlug: string | null;
  courseAccessGrantedAt: string | null;
  courseAccessQueued?: boolean;
  contactEmail: string | null;
}

/** Texto del paso Acceso en los cupos adicionales (sin alta en Tiendup). */
export const SIN_TIENDUP_LABEL = "Sin alta Tiendup (cupo adicional)";

const zone = "America/Argentina/Buenos_Aires";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: zone, dateStyle: "short" });
const shortDate = new Intl.DateTimeFormat("es-AR", { timeZone: zone, day: "numeric", month: "short" });

export function cardDate(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  // Las fechas de catálogo sin hora representan el día local.
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso);
  return shortDate.formatToParts(date)
    .filter(({ type }) => type === "day" || type === "month")
    .map(({ value }) => value.replace(/\./g, "")).join(" ");
}

export function datedStatus(label: string, iso: string | null): string {
  const date = cardDate(iso);
  return date ? `${label} el ${date}` : label;
}

export function titleStep(
  state: TitleState,
  { reviewedAt = null, now, waiting = false, historical = false }: {
    reviewedAt?: string | null;
    now: number;
    waiting?: boolean;
    historical?: boolean;
  },
): CardStep {
  const base = { key: "title", label: "Título" } as const;
  if (state === "valid") {
    const date = cardDate(reviewedAt);
    const day = date && dayKey.format(new Date(reviewedAt!));
    const detail = day && day === dayKey.format(now) ? "Validado hoy"
      : day && day === dayKey.format(now - 86_400_000) ? "Validado ayer"
      : datedStatus("Validado", reviewedAt);
    return { ...base, status: "done", detail };
  }
  if (state === "exempt") return { ...base, status: "done", detail: "Ya entregado · alumna registrada" };
  if (historical) return { ...base, status: "future", detail: "Sin registro para este evento" };
  if (state === "review") return { ...base, status: "current", detail: "En revisión", actions: ["reviewTitle"] };
  if (state === "rejected") return { ...base, status: "error", detail: "Rechazado" };
  if (waiting) return { ...base, status: "current", detail: "Esperando título" };
  return { ...base, status: "future", detail: "No enviado" };
}

export function cardSteps(payment: CardPayment, now: number): CardStep[] {
  const pending = payment.status === "pending";
  const approved = payment.status === "validated";
  const retained = pending && payment.awaitingTitle;
  const state = titleState(payment.titles, payment.titleExempt);
  const reviewedAt = payment.titles
    .filter((title) => title.isValid && title.reviewedAt)
    .map((title) => title.reviewedAt!)
    .sort().at(-1);
  const title = titleStep(state, { now, reviewedAt, waiting: retained });
  if (retained) title.actions = [...(title.actions ?? []), "force"];
  // Cuando la revisión del título no retiene el pago, ambos siguen operables:
  // los dos pasos quedan "current" para que cada acción viva en su paso.
  const steps: CardStep[] = [
    title,
    { key: "receipt", label: "Comprobante", status: "done", detail: datedStatus("Recibido", payment.createdAt) },
    {
      key: "payment", label: "Pago",
      status: approved ? "done" : !pending ? "error" : retained ? "future" : "current",
      detail: approved ? datedStatus("Aprobado", payment.validatedAt)
        : !pending ? "Rechazado" : retained ? "Después de validar el título" : "Esperando aprobación del equipo",
      actions: pending ? retained ? ["reject"] : ["approve", "reject"] : undefined,
    },
  ];
  const event = eventBySlug(payment.eventSlug);
  if (event?.sinTiendup) {
    // Cupo adicional: se aprueba en el panel y no hay alta que dar ni que reintentar.
    steps.push({ key: "access", label: "Acceso al curso", status: "future", detail: SIN_TIENDUP_LABEL });
  } else if (event && event.slug !== "congreso") {
    const granted = payment.courseAccessGrantedAt;
    const missingEmail = !payment.contactEmail?.trim();
    steps.push({
      key: "access", label: "Acceso al curso",
      status: !approved ? "future" : granted ? "done" : "current",
      detail: !approved ? pending ? "Después de aprobar el pago" : "Sin acceso"
        : granted ? datedStatus("Dado", granted)
        : missingEmail ? "Falta el mail"
        : payment.courseAccessQueued ? "En cola, se reintenta solo" : "Pendiente de alta",
      actions: approved && !granted ? [missingEmail ? "email" : "grant", "mark"] : undefined,
    });
  }
  return steps;
}
