import type { PaymentItem, TitleReview, TitleSubmission } from "@/app/api/payments/route";
import type { ContactFile } from "@/app/api/wa/contact/[conversationId]/route";

// Ítems de la cola de /revision: un archivo por ítem (comprobante pendiente,
// con todas las imágenes del mismo pago, o título para revisar), armados con la MISMA respuesta de GET /api/payments que
// usa Aprobaciones. Nada de consultas propias.

export interface ReviewItem {
  /** Id del comprobante o del título (es lo que va en ?id=). */
  id: string;
  kind: "comprobante" | "titulo";
  conversationId: string | null;
  name: string;
  phone: string | null;
  eventSlug: string | null;
  amount: number | null;
  currency: string | null;
  createdAt: string;
  /** Comprobante retenido hasta validar el título profesional. */
  awaitingTitle: boolean;
  /** Archivo en el formato de FileReviewPanel. */
  file: ContactFile;
  /** Datos completos del comprobante (null en títulos). */
  payment: PaymentItem | null;
}

type Conv = PaymentItem["conversation"];

function needsReview(t: TitleSubmission): boolean {
  return !t.isValid && !t.reviewedAt;
}

export function titleFile(t: TitleSubmission): ContactFile {
  return {
    id: t.id,
    kind: "titulo",
    url: t.url,
    fileType: t.fileType,
    createdAt: t.createdAt,
    status: "review",
    eventSlug: null,
    amount: null,
    currency: null,
    titleName: t.titleName,
    institution: t.institution,
  };
}

function titleItem(t: TitleSubmission, conv: Conv, fallbackName: string | null): ReviewItem {
  return {
    id: t.id,
    kind: "titulo",
    conversationId: conv?.id ?? null,
    name: conv?.displayName ?? fallbackName ?? "(sin nombre)",
    phone: conv?.phone ?? null,
    eventSlug: null,
    amount: null,
    currency: null,
    createdAt: t.createdAt,
    awaitingTitle: false,
    file: titleFile(t),
    payment: null,
  };
}

/**
 * Comprobantes pendientes (incluidos los retenidos por título) y títulos sin
 * revisar, del más antiguo al más nuevo (cola de trabajo, como Aprobaciones).
 * Con búsqueda el servidor trae todos los estados: acá quedan solo los
 * pendientes.
 */
export function buildReviewItems(items: PaymentItem[], titleReviews: TitleReview[]): ReviewItem[] {
  const out: ReviewItem[] = [];
  const seenTitles = new Set<string>();

  for (const p of items) {
    if (p.status !== "pending") continue;
    out.push({
      id: p.id,
      kind: "comprobante",
      conversationId: p.conversation?.id ?? null,
      name: p.conversation?.displayName ?? p.contactName ?? p.senderName ?? "(sin nombre)",
      phone: p.conversation?.phone ?? null,
      eventSlug: p.eventSlug,
      amount: p.amount,
      currency: p.currency,
      createdAt: p.createdAt,
      awaitingTitle: p.awaitingTitle,
      file: {
        id: p.id,
        kind: "comprobante",
        url: p.comprobanteUrl,
        fileType: p.comprobanteType,
        createdAt: p.createdAt,
        status: p.awaitingTitle ? "awaiting_title" : "pending",
        eventSlug: p.eventSlug,
        amount: p.amount,
        currency: p.currency,
        titleName: null,
        institution: null,
        // Varias imágenes del mismo pago: un solo ítem (grouping.ts).
        images: p.groupImages,
        maybeDistinct: p.groupMaybeDistinct,
      },
      payment: p,
    });
    // Títulos sin revisar de la misma conversación: en Aprobaciones van dentro
    // de la tarjeta del comprobante; acá son ítems propios.
    for (const t of p.titles) {
      if (!needsReview(t) || seenTitles.has(t.id)) continue;
      seenTitles.add(t.id);
      out.push(titleItem(t, p.conversation, p.contactName));
    }
  }

  for (const tr of titleReviews) {
    for (const t of tr.submissions) {
      if (!needsReview(t) || seenTitles.has(t.id)) continue;
      seenTitles.add(t.id);
      out.push(titleItem(t, tr.conversation, null));
    }
  }

  return out.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

/** "12 min", "3 h", "4 d" desde una fecha ISO. */
export function fmtAge(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function fmtAmount(amount: number | null, currency: string | null): string | null {
  if (amount === null) return null;
  const cur = currency === "USD" ? "USD " : "$";
  return `${cur}${Math.round(amount).toLocaleString("es-AR")}`;
}
