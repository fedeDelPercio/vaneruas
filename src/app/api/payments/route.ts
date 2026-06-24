import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getComprobanteSignedUrl } from "@/lib/payments/storage";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/payments?status=pending|validated|rejected|all
//
// Lista los comprobantes de pago de este cliente, ordenados por fecha desc.
// Resuelve la conversación de origen, el validador (profiles) y una signed URL
// de vida corta para mostrar la imagen del comprobante. El aislamiento por
// cliente lo enforce RLS via el JWT con claim client_slug.
// ===========================================================================

const MAX_ITEMS = 300;

/** Un título profesional que la contacta mandó para acreditarse. */
export interface TitleSubmission {
  id: string;
  url: string | null;
  fileType: string | null;
  holderName: string | null;
  titleName: string | null;
  institution: string | null;
  /** Veredicto vigente: true si una IA o una persona lo dieron por válido. */
  isValid: boolean;
  /** Sello de revisión manual (null = todavía nadie del equipo lo miró). */
  reviewedAt: string | null;
  validationNote: string | null;
  createdAt: string;
}

/**
 * Caso de "título a validar" sin comprobante asociado pendiente: la contacta
 * mandó algo para acreditarse que la IA no dio por bueno, y todavía no hay un
 * comprobante retenido que lo agrupe. Se revisa desde el mismo panel.
 */
export interface TitleReview {
  conversation: { id: string; displayName: string; source: string; externalId: string | null; phone: string | null; ghlConversationId: string | null } | null;
  submissions: TitleSubmission[];
  /** Último mensaje de texto de la contacta (ej. una negativa a mandar el título). */
  contactNote: string | null;
  /** Fecha del envío más reciente, para ordenar junto a los comprobantes. */
  createdAt: string;
}

/** Resumen para la cabecera del panel (las gestoras no ven Métricas). */
export interface PaymentStats {
  /** Comprobantes en estado pendiente (todos, no solo la pagina actual). */
  pending: number;
  /** Promedio de tiempo desde que entra el comprobante hasta que se valida (ms). */
  avgValidationMs: number | null;
}

export interface PaymentItem {
  id: string;
  status: "pending" | "validated" | "rejected";
  createdAt: string;
  senderName: string | null;
  senderTaxId: string | null;
  recipientName: string | null;
  recipientTaxId: string | null;
  amount: number | null;
  currency: string | null;
  transferDateRaw: string | null;
  transferredAt: string | null;
  operationNumber: string | null;
  bankOrMethod: string | null;
  concept: string | null;
  extractionConfidence: string | null;
  contactName: string | null;
  contactEmail: string | null;
  eventSlug: string | null;
  comprobanteUrl: string | null;
  comprobanteType: string | null;
  /** true si otro comprobante anterior comparte el mismo N° de operación. */
  isDuplicate: boolean;
  /** true si el contacto YA tiene otro comprobante validado en esta conversación. */
  contactHasValidatedPayment: boolean;
  /** true si el comprobante está retenido esperando validar el título profesional. */
  awaitingTitle: boolean;
  /** true si no se pudo avisar al cliente al aprobar (ej. ventana de 24h vencida). */
  deliveryFailed: boolean;
  /** Detalle del error de entrega, si lo hubo. */
  deliveryError: string | null;
  /** Títulos que mandó la contacta en la misma conversación (cert primero). */
  titles: TitleSubmission[];
  /** Último mensaje de texto de la contacta (útil cuando hay un comprobante retenido). */
  contactNote: string | null;
  conversation: { id: string; displayName: string; source: string; externalId: string | null; phone: string | null; ghlConversationId: string | null } | null;
  validatedAt: string | null;
  validationNote: string | null;
  validatedByName: string | null;
}

export async function GET(req: NextRequest) {
  const sb = getSupabaseServerClient();
  const status = req.nextUrl.searchParams.get("status") ?? "all";

  let query = sb
    .from("payment_validations")
    .select("*")
    // Más antiguo primero: el equipo prioriza a quien envió antes (cola de trabajo).
    .order("created_at", { ascending: true })
    .limit(MAX_ITEMS);

  if (status === "pending" || status === "validated" || status === "rejected") {
    query = query.eq("status", status);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows?.length) {
    return NextResponse.json({ items: [] satisfies PaymentItem[] });
  }

  // Resolver conversaciones de origen.
  const convIds = Array.from(
    new Set(rows.map((r) => r.conversation_id).filter(Boolean) as string[]),
  );
  const { data: convs } = convIds.length
    ? await sb.from("conversations").select("id, display_name, source, contact_email, external_id, wa_jid, ghl_conversation_id").in("id", convIds)
    : { data: [] };
  const convById = new Map((convs ?? []).map((c) => [c.id, c]));

  // ¿Qué conversaciones ya tienen ALGÚN comprobante validado? Sirve para avisar
  // en la tarjeta que ese contacto ya está aprobado y este envío es adicional
  // (pasa seguido: mandan el comprobante, después una segunda foto / constancia /
  // un GIF; el real ya se validó y el resto es ruido).
  const { data: validatedRows } = convIds.length
    ? await sb
        .from("payment_validations")
        .select("id, conversation_id")
        .eq("status", "validated")
        .in("conversation_id", convIds)
    : { data: [] };
  const validatedIdsByConv = new Map<string, Set<string>>();
  for (const vr of validatedRows ?? []) {
    if (!vr.conversation_id) continue;
    const set = validatedIdsByConv.get(vr.conversation_id) ?? new Set<string>();
    set.add(vr.id);
    validatedIdsByConv.set(vr.conversation_id, set);
  }

  // Resolver validadores.
  const validatorIds = Array.from(
    new Set(rows.map((r) => r.validated_by).filter(Boolean) as string[]),
  );
  const { data: validators } = validatorIds.length
    ? await sb.from("profiles").select("id, name").in("id", validatorIds)
    : { data: [] };
  const validatorById = new Map((validators ?? []).map((p) => [p.id, p]));

  // Detección de duplicados: comprobantes que comparten N° de operación. Se
  // evalúa sobre TODA la tabla del cliente (no solo el filtro de estado
  // actual), así un pendiente que repite un pago ya validado se marca igual.
  // La fila más antigua por N° de operación es la "original"; las posteriores
  // se marcan como duplicado.
  const { data: allOps } = await sb
    .from("payment_validations")
    .select("id, operation_number, created_at")
    .not("operation_number", "is", null);
  const norm = (op: string | null) => (op ?? "").trim().toUpperCase();
  const earliestIdByOp = new Map<string, { id: string; createdAt: string }>();
  const countByOp = new Map<string, number>();
  for (const r of allOps ?? []) {
    const op = norm(r.operation_number);
    if (!op) continue;
    countByOp.set(op, (countByOp.get(op) ?? 0) + 1);
    const prev = earliestIdByOp.get(op);
    if (!prev || r.created_at < prev.createdAt) {
      earliestIdByOp.set(op, { id: r.id, createdAt: r.created_at });
    }
  }
  const duplicateIds = new Set<string>();
  for (const r of allOps ?? []) {
    const op = norm(r.operation_number);
    if (!op) continue;
    if ((countByOp.get(op) ?? 0) > 1 && earliestIdByOp.get(op)?.id !== r.id) {
      duplicateIds.add(r.id);
    }
  }

  // Signed URLs (en paralelo) para mostrar los comprobantes.
  const signedUrls = await Promise.all(
    rows.map((r) =>
      r.comprobante_path ? getComprobanteSignedUrl(r.comprobante_path) : Promise.resolve(null),
    ),
  );

  // Títulos profesionales que mandaron estas contactas (para agrupar con su
  // comprobante: el certificado primero, después el comprobante).
  const wantTitlesFor =
    status === "pending" || status === "all"
      ? // En las vistas de revisión traemos también títulos de conversaciones que
        // todavía no tienen comprobante (casos "solo título a validar").
        undefined
      : convIds;
  let titleQuery = sb
    .from("professional_titles")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(MAX_ITEMS);
  if (wantTitlesFor) {
    if (!wantTitlesFor.length) titleQuery = titleQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    else titleQuery = titleQuery.in("conversation_id", wantTitlesFor);
  }
  const { data: titleRows } = await titleQuery;
  const titleSigned = await Promise.all(
    (titleRows ?? []).map((t) =>
      t.file_path ? getComprobanteSignedUrl(t.file_path) : Promise.resolve(null),
    ),
  );
  const titlesByConv = new Map<string, TitleSubmission[]>();
  (titleRows ?? []).forEach((t, i) => {
    if (!t.conversation_id) return;
    const sub: TitleSubmission = {
      id: t.id,
      url: titleSigned[i] ?? null,
      fileType: t.file_type,
      holderName: t.holder_name,
      titleName: t.title_name,
      institution: t.institution,
      isValid: t.is_valid,
      reviewedAt: t.reviewed_at,
      validationNote: t.validation_note,
      createdAt: t.created_at,
    };
    const arr = titlesByConv.get(t.conversation_id) ?? [];
    arr.push(sub);
    titlesByConv.set(t.conversation_id, arr);
  });

  // Resolver conversaciones de títulos que no tienen comprobante en la lista.
  const missingConvIds = Array.from(titlesByConv.keys()).filter((id) => !convById.has(id));
  if (missingConvIds.length) {
    const { data: moreConvs } = await sb
      .from("conversations")
      .select("id, display_name, source, contact_email, external_id, wa_jid, ghl_conversation_id")
      .in("id", missingConvIds);
    (moreConvs ?? []).forEach((c) => convById.set(c.id, c));
  }

  // Último mensaje de texto de la contacta por conversación (para mostrar
  // contexto, ej. una negativa a mandar el título). Se calcula para las
  // conversaciones con comprobante retenido o con título a revisar.
  const noteConvIds = Array.from(
    new Set([
      ...rows.filter((r) => r.awaiting_title).map((r) => r.conversation_id),
      ...titlesByConv.keys(),
    ].filter(Boolean) as string[]),
  );
  const contactNoteByConv = new Map<string, string>();
  if (noteConvIds.length) {
    const { data: userMsgs } = await sb
      .from("messages")
      .select("conversation_id, content, created_at")
      .in("conversation_id", noteConvIds)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(400);
    for (const m of userMsgs ?? []) {
      if (!m.conversation_id || contactNoteByConv.has(m.conversation_id)) continue;
      const text = (m.content ?? "").trim();
      if (text) contactNoteByConv.set(m.conversation_id, text);
    }
  }

  const items: PaymentItem[] = rows.map((r, i) => {
    const conv = r.conversation_id ? convById.get(r.conversation_id) : null;
    const validator = r.validated_by ? validatorById.get(r.validated_by) : null;
    // "Ya validado" si hay OTRA fila validada (distinta a esta) en la misma conv.
    const validatedSet = r.conversation_id ? validatedIdsByConv.get(r.conversation_id) : null;
    const contactHasValidatedPayment = Boolean(
      validatedSet && [...validatedSet].some((id) => id !== r.id),
    );
    return {
      id: r.id,
      status: r.status as PaymentItem["status"],
      createdAt: r.created_at,
      senderName: r.sender_name,
      senderTaxId: r.sender_tax_id,
      recipientName: r.recipient_name,
      recipientTaxId: r.recipient_tax_id,
      amount: r.amount === null ? null : Number(r.amount),
      currency: r.currency,
      transferDateRaw: r.transfer_date_raw,
      transferredAt: r.transferred_at,
      operationNumber: r.operation_number,
      bankOrMethod: r.bank_or_method,
      concept: r.concept,
      extractionConfidence: r.extraction_confidence,
      contactName: r.contact_name,
      contactEmail: conv?.contact_email ?? r.contact_email,
      eventSlug: r.event_slug,
      comprobanteUrl: signedUrls[i] ?? null,
      comprobanteType: r.comprobante_type,
      isDuplicate: duplicateIds.has(r.id),
      contactHasValidatedPayment,
      awaitingTitle: r.awaiting_title ?? false,
      deliveryFailed: r.delivery_failed ?? false,
      deliveryError: r.delivery_error ?? null,
      titles: r.conversation_id ? titlesByConv.get(r.conversation_id) ?? [] : [],
      contactNote: r.conversation_id
        ? contactNoteByConv.get(r.conversation_id) ?? null
        : null,
      conversation: conv
        ? { id: conv.id, displayName: conv.display_name ?? "(sin nombre)", source: conv.source, externalId: conv.external_id ?? null, phone: conv.wa_jid ?? null, ghlConversationId: conv.ghl_conversation_id ?? null }
        : null,
      validatedAt: r.validated_at,
      validationNote: r.validation_note,
      validatedByName: validator?.name ?? null,
    };
  });

  // Casos de "título a validar" sin comprobante que los agrupe: conversaciones
  // con un título a revisar (no validado y sin revisión manual) que NO tienen un
  // comprobante retenido en la lista actual (esos ya muestran el título en su
  // card). Solo en las vistas de revisión (pendientes / todos).
  const heldConvIds = new Set(
    rows.filter((r) => r.awaiting_title).map((r) => r.conversation_id).filter(Boolean) as string[],
  );
  const titleReviews: TitleReview[] = [];
  if (status === "pending" || status === "all") {
    for (const [convId, submissions] of titlesByConv) {
      if (heldConvIds.has(convId)) continue;
      const pendientes = submissions.filter((s) => !s.isValid && !s.reviewedAt);
      if (!pendientes.length) continue;
      const conv = convById.get(convId);
      const createdAt =
        submissions.map((s) => s.createdAt).sort().slice(-1)[0] ?? "";
      titleReviews.push({
        conversation: conv
          ? { id: conv.id, displayName: conv.display_name ?? "(sin nombre)", source: conv.source, externalId: conv.external_id ?? null, phone: conv.wa_jid ?? null, ghlConversationId: conv.ghl_conversation_id ?? null }
          : null,
        submissions,
        contactNote: contactNoteByConv.get(convId) ?? null,
        createdAt,
      });
    }
    titleReviews.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // Resumen para la cabecera: cantidad de pendientes y tiempo promedio de
  // validación, sobre TODA la tabla del cliente (no solo el filtro/pagina).
  const { data: statRows } = await sb
    .from("payment_validations")
    .select("status, created_at, validated_at");
  let pending = 0;
  let sumMs = 0;
  let validatedCount = 0;
  for (const r of statRows ?? []) {
    if (r.status === "pending") pending++;
    if (r.status === "validated" && r.validated_at && r.created_at) {
      const ms = new Date(r.validated_at).getTime() - new Date(r.created_at).getTime();
      if (ms >= 0) {
        sumMs += ms;
        validatedCount++;
      }
    }
  }
  const stats: PaymentStats = {
    pending,
    avgValidationMs: validatedCount ? Math.round(sumMs / validatedCount) : null,
  };

  return NextResponse.json({ items, titleReviews, stats });
}
