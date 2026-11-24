import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { COMPROBANTES_BUCKET } from "@/lib/payments/storage";
import { matchesContactQuery } from "@/lib/search";
import { loadOpenTeamNotificationCounts } from "@/lib/interventions";
import { clientEnv } from "@/lib/env";
import { groupPendingPayments } from "@/lib/payments/grouping";
import { canonicoDeAgrupado } from "@/lib/payments/dismiss";
import { needsCourseAccess, previousMasterclasses } from "@/lib/payments/revision-card";
import { displayCourseAccessError } from "@/lib/tiendup/messages";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/payments?status=pending|validated|rejected|all   (o ?q=<búsqueda>)
//     &with=interventions (Revisión) o &with=access (Aprobaciones)
//
// Lista los comprobantes de pago de este cliente, del más antiguo al más nuevo
// (cola de trabajo). Con ?q= busca por persona en todos los estados.
// Resuelve la conversación de origen, el validador (profiles) y una signed URL
// de vida corta para mostrar la imagen del comprobante. El aislamiento por
// cliente lo enforce RLS via el JWT con claim client_slug.
// ===========================================================================

// La lista trae TODOS los comprobantes del estado pedido, sin tope: con un
// tope fijo y orden ascendente, lo que se perdía en silencio eran los más
// nuevos (pasó con 300 y habría vuelto a pasar con 2000).

/** Un título profesional que la contacta mandó para acreditarse. */
export interface TitleSubmission {
  id: string;
  hasFile: boolean;
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
  /** Total de pendientes, incluyendo entregas de acceso con with=access. */
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
  agendada: boolean | null;
  titleExempt: boolean;
  previousMasterclasses: string[];
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
  /** Cuándo se le dio acceso al curso en Tiendup (null = todavía no). */
  courseAccessGrantedAt: string | null;
  /** Detalle del último error al intentar dar acceso al curso. */
  courseAccessError: string | null;
  /** Títulos que mandó la contacta en la misma conversación (cert primero). */
  titles: TitleSubmission[];
  /** Último mensaje de texto de la contacta (útil cuando hay un comprobante retenido). */
  contactNote: string | null;
  conversation: { id: string; displayName: string; source: string; externalId: string | null; phone: string | null; ghlConversationId: string | null } | null;
  validatedAt: string | null;
  validationNote: string | null;
  validatedByName: string | null;
  /**
   * Imágenes del mismo pago (grouping.ts), incluida la de este ítem, de la más
   * vieja a la más nueva. Una sola = no hay grupo. En pendientes son los
   * hermanos que se resuelven juntos; en resueltos, las agrupadas al aprobar.
   */
  groupImages: GroupImage[];
  /** Montos leídos distintos dentro del grupo: avisar "parecen pagos distintos". */
  groupMaybeDistinct: boolean;
}

/** Una imagen de un grupo de comprobantes. */
export interface GroupImage {
  id: string;
  url: string | null;
  fileType: string | null;
  createdAt: string;
  amount: number | null;
  operationNumber: string | null;
}

// Ids por consulta cuando la lista viaja en la URL (`.in(...)`). Pasar cientos
// de una vez desborda el tamaño máximo del pedido y PostgREST no contesta: así
// se perdían el nombre y el teléfono del contacto en "Validados" y "Todos".
const IN_CHUNK = 100;
// Paths por pedido de firma al Storage.
const SIGN_CHUNK = 200;
const SIGNED_URL_TTL_SECONDS = 300;

function chunked<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface ConvLite {
  id: string;
  display_name: string;
  source: string;
  contact_email: string | null;
  external_id: string | null;
  wa_jid: string | null;
  ghl_conversation_id: string | null;
  agendada: boolean;
  is_existing_customer: boolean;
}

function convSummary(conv: ConvLite | null | undefined): PaymentItem["conversation"] {
  if (!conv) return null;
  return {
    id: conv.id,
    displayName: conv.display_name ?? "(sin nombre)",
    source: conv.source,
    externalId: conv.external_id ?? null,
    phone: conv.wa_jid ?? null,
    ghlConversationId: conv.ghl_conversation_id ?? null,
  };
}

export async function GET(req: NextRequest) {
  const sb = getSupabaseServerClient();
  const status = req.nextUrl.searchParams.get("status") ?? "all";
  // Búsqueda por persona (nombre, teléfono, correo, emisor o N° de operación).
  // Con búsqueda se ignora el estado: se busca en todos los comprobantes.
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const searching = q.length >= 2;
  const reviewView = searching || status === "pending" || status === "all";

  // Conversaciones ya resueltas (se van sumando a medida que hacen falta).
  const convById = new Map<string, ConvLite>();
  async function resolveConversations(ids: string[]): Promise<void> {
    const missing = Array.from(new Set(ids)).filter((id) => !convById.has(id));
    if (!missing.length) return;
    const results = await Promise.all(
      chunked(missing, IN_CHUNK).map((chunk) =>
        sb
          .from("conversations")
          .select("id, display_name, source, contact_email, external_id, wa_jid, ghl_conversation_id, agendada, is_existing_customer")
          .in("id", chunk),
      ),
    );
    for (const r of results) {
      // Un fallo acá dejaba las tarjetas sin nombre ni teléfono, en silencio.
      if (r.error) throw new Error(r.error.message);
      for (const c of r.data ?? []) convById.set(c.id, c);
    }
  }

  // Firma de archivos del bucket privado, de a muchos por pedido (antes era un
  // pedido por archivo: con 900 comprobantes, la lista tardaba decenas de
  // segundos).
  async function signPaths(paths: string[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(paths));
    const out = new Map<string, string>();
    if (!unique.length) return out;
    const storage = getSupabaseAdminClient().storage.from(COMPROBANTES_BUCKET);
    const results = await Promise.all(
      chunked(unique, SIGN_CHUNK).map((chunk) => storage.createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS)),
    );
    for (const r of results) {
      for (const item of r.data ?? []) {
        if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
      }
    }
    return out;
  }

  // 1. TODOS los comprobantes del cliente, paginados (PostgREST corta en 1000
  //    filas; sin paginar, "Todos" mostraba solo los 1000 más viejos). De esta
  //    misma lectura salen los duplicados, "ya tiene un pago validado" y el
  //    resumen de la cabecera, que antes eran tres consultas más.
  let allRows;
  try {
    allRows = await fetchAllRows((from, to) =>
      sb
        .from("payment_validations")
        .select(
          "id, conversation_id, comprobante_path, comprobante_type, sender_name, sender_tax_id, recipient_name, recipient_tax_id, amount, currency, transfer_date_raw, transferred_at, operation_number, bank_or_method, concept, extraction_confidence, contact_name, contact_email, event_slug, status, awaiting_title, delivery_failed, delivery_error, course_access_granted_at, course_access_error, validated_by, validated_at, validation_note, created_at",
        )
        // Más antiguo primero: el equipo prioriza a quien envió antes (cola de trabajo).
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudieron cargar los comprobantes" },
      { status: 500 },
    );
  }

  // Grupos: varias imágenes del mismo pago se muestran (y se resuelven) como
  // UN comprobante (src/lib/payments/grouping.ts). Pendientes: se agrupan en
  // vivo y la lista muestra solo el canónico. Resueltos: las imágenes extra
  // quedaron `rejected` con la nota de agrupado y se cuelgan de su canónico.
  type Row = (typeof allRows)[number];
  const membersByCanonical = new Map<string, Row[]>();
  const maybeDistinctIds = new Set<string>();
  const hiddenIds = new Set<string>();
  const pendingGroups = groupPendingPayments(allRows);
  for (const g of pendingGroups) {
    membersByCanonical.set(g.canonical.id, g.members);
    if (g.maybeDistinct) maybeDistinctIds.add(g.canonical.id);
    for (const m of g.members) if (m.id !== g.canonical.id) hiddenIds.add(m.id);
  }
  const rowById = new Map(allRows.map((r) => [r.id, r]));
  for (const r of allRows) {
    const canonicalId = canonicoDeAgrupado(r);
    if (!canonicalId) continue;
    hiddenIds.add(r.id);
    const canonical = rowById.get(canonicalId);
    if (!canonical) continue;
    const arr = membersByCanonical.get(canonicalId) ?? [canonical];
    arr.push(r);
    membersByCanonical.set(canonicalId, arr);
  }
  for (const arr of membersByCanonical.values()) {
    arr.sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at < b.created_at ? -1 : 1));
  }

  // Resumen para la cabecera: pendientes (por grupo) y tiempo promedio de
  // validación.
  const pendingCount = pendingGroups.length;
  // Pendientes de Aprobaciones y Falta acceso comparten el criterio de entrega.
  // Revisión conserva su cola de archivos. Ambas mantienen el orden de llegada.
  const includeAccess = req.nextUrl.searchParams.get("with") === "access";
  const accessRows = new Set(includeAccess ? allRows.filter((r) => !hiddenIds.has(r.id) &&
    needsCourseAccess(r.event_slug, r.status, r.course_access_granted_at)).map((r) => r.id) : []);
  let sumMs = 0;
  let validatedCount = 0;
  for (const r of allRows) {
    if (r.status === "validated" && r.validated_at && r.created_at) {
      const ms = new Date(r.validated_at).getTime() - new Date(r.created_at).getTime();
      if (ms >= 0) {
        sumMs += ms;
        validatedCount++;
      }
    }
  }
  const stats: PaymentStats = {
    pending: pendingCount + accessRows.size,
    avgValidationMs: validatedCount ? Math.round(sumMs / validatedCount) : null,
  };

  // ¿Qué conversaciones ya tienen ALGÚN comprobante validado? Sirve para avisar
  // en la tarjeta que ese contacto ya está aprobado y este envío es adicional
  // (pasa seguido: mandan el comprobante, después una segunda foto / constancia /
  // un GIF; el real ya se validó y el resto es ruido).
  const validatedIdsByConv = new Map<string, Set<string>>();
  for (const r of allRows) {
    if (r.status !== "validated" || !r.conversation_id) continue;
    const set = validatedIdsByConv.get(r.conversation_id) ?? new Set<string>();
    set.add(r.id);
    validatedIdsByConv.set(r.conversation_id, set);
  }

  // Detección de duplicados: comprobantes que comparten N° de operación, sobre
  // TODA la tabla (así un pendiente que repite un pago ya validado se marca
  // igual). La fila más antigua por N° de operación es la "original".
  const norm = (op: string | null) => (op ?? "").trim().toUpperCase();
  const earliestIdByOp = new Map<string, { id: string; createdAt: string }>();
  const countByOp = new Map<string, number>();
  for (const r of allRows) {
    const op = norm(r.operation_number);
    if (!op) continue;
    countByOp.set(op, (countByOp.get(op) ?? 0) + 1);
    const prev = earliestIdByOp.get(op);
    if (!prev || r.created_at < prev.createdAt) {
      earliestIdByOp.set(op, { id: r.id, createdAt: r.created_at });
    }
  }
  const duplicateIds = new Set<string>();
  for (const r of allRows) {
    const op = norm(r.operation_number);
    if (!op) continue;
    if ((countByOp.get(op) ?? 0) > 1 && earliestIdByOp.get(op)?.id !== r.id) {
      duplicateIds.add(r.id);
    }
  }

  // 2. Las filas que se muestran: por estado, o por búsqueda en todos.
  let rows = allRows;
  if (searching) {
    await resolveConversations(
      allRows.map((r) => r.conversation_id).filter(Boolean) as string[],
    );
    rows = allRows.filter((r) => {
      const conv = r.conversation_id ? convById.get(r.conversation_id) : null;
      return matchesContactQuery(q, {
        texts: [
          conv?.display_name,
          conv?.contact_email,
          r.sender_name,
          r.contact_name,
          r.contact_email,
          r.operation_number,
        ],
        phones: [conv?.wa_jid],
      });
    });
  } else if (status === "pending" || status === "validated" || status === "rejected") {
    rows = allRows.filter((r) => r.status === status || (status === "pending" && accessRows.has(r.id)));
  }

  // Las imágenes extra de un grupo no son ítems propios: van dentro del canónico.
  rows = rows.filter((r) => !hiddenIds.has(r.id));

  const convIds = Array.from(
    new Set(rows.map((r) => r.conversation_id).filter(Boolean) as string[]),
  );
  await resolveConversations(convIds);
  const rowConvIds = new Set(convIds);
  // La lectura paginada de pagos ya contiene el historial local. Se indexa
  // una sola vez para las conversaciones de esta respuesta.
  const historyByConv = new Map<string, Row[]>();
  for (const r of allRows) {
    if (!r.conversation_id || !rowConvIds.has(r.conversation_id) ||
        r.status !== "validated" || hiddenIds.has(r.id)) continue;
    const history = historyByConv.get(r.conversation_id) ?? [];
    history.push(r);
    historyByConv.set(r.conversation_id, history);
  }

  // Resolver validadores.
  const validatorIds = Array.from(
    new Set(rows.map((r) => r.validated_by).filter(Boolean) as string[]),
  );
  const { data: validators } = validatorIds.length
    ? await sb.from("profiles").select("id, name").in("id", validatorIds)
    : { data: [] };
  const validatorById = new Map((validators ?? []).map((p) => [p.id, p]));

  // 3. Títulos profesionales (para agrupar con su comprobante: el certificado
  //    primero, después el comprobante). En las vistas de revisión entran
  //    también los de conversaciones que todavía no tienen comprobante (casos
  //    "solo título a validar").
  const titleRows = await fetchAllRows((from, to) =>
      sb
        .from("professional_titles")
        .select(
          "id, conversation_id, file_path, file_type, holder_name, title_name, institution, is_valid, reviewed_at, validation_note, created_at",
        )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
  ).catch(() => []);
  const heldConvIds = new Set(
    rows.filter((r) => r.awaiting_title).map((r) => r.conversation_id).filter(Boolean) as string[],
  );
  // Conversaciones con un título a revisar y sin comprobante retenido que lo
  // agrupe: van como card aparte.
  // Tampoco si la conversación tiene un comprobante pendiente a la vista: su
  // tarjeta ya muestra los títulos con los mismos botones, y la segunda
  // tarjeta ("Sin comprobante") duplicaba a la persona y confundía.
  const pendingRowConvIds = new Set(
    rows.filter((r) => r.status === "pending").map((r) => r.conversation_id).filter(Boolean) as string[],
  );
  const reviewConvIds = new Set<string>();
  if (reviewView) {
    for (const t of titleRows) {
      if (!t.conversation_id || heldConvIds.has(t.conversation_id)) continue;
      if (pendingRowConvIds.has(t.conversation_id)) continue;
      if (!t.is_valid && !t.reviewed_at) reviewConvIds.add(t.conversation_id);
    }
  }
  if (searching && reviewConvIds.size) {
    // Con búsqueda, los títulos a revisar también se filtran por la persona.
    await resolveConversations(Array.from(reviewConvIds));
    for (const id of Array.from(reviewConvIds)) {
      const conv = convById.get(id);
      const ok = matchesContactQuery(q, {
        texts: [conv?.display_name, conv?.contact_email],
        phones: [conv?.wa_jid],
      });
      if (!ok) reviewConvIds.delete(id);
    }
  }
  const shownTitles = titleRows.filter(
    (t) => t.conversation_id && (rowConvIds.has(t.conversation_id) || reviewConvIds.has(t.conversation_id)),
  );

  // Una sola tanda de firmas para comprobantes y títulos.
  const groupRows = rows.flatMap((r) => membersByCanonical.get(r.id) ?? []);
  const signed = await signPaths([
    ...(rows.map((r) => r.comprobante_path).filter(Boolean) as string[]),
    ...(groupRows.map((r) => r.comprobante_path).filter(Boolean) as string[]),
    ...(shownTitles.map((t) => t.file_path).filter(Boolean) as string[]),
  ]);

  const titlesByConv = new Map<string, TitleSubmission[]>();
  for (const t of shownTitles) {
    if (!t.conversation_id) continue;
    const sub: TitleSubmission = {
      id: t.id,
      hasFile: Boolean(t.file_path),
      url: t.file_path ? signed.get(t.file_path) ?? null : null,
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
  }
  await resolveConversations(Array.from(reviewConvIds));

  // Último mensaje de texto de la contacta por conversación (para mostrar
  // contexto, ej. una negativa a mandar el título). Se calcula para las
  // conversaciones con comprobante retenido o con título a revisar.
  const noteConvIds = Array.from(new Set([...heldConvIds, ...reviewConvIds]));
  const contactNoteByConv = new Map<string, string>();
  if (noteConvIds.length) {
    const results = await Promise.all(
      chunked(noteConvIds, 50).map((chunk) =>
        sb
          .from("messages")
          .select("conversation_id, content, created_at")
          .in("conversation_id", chunk)
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .limit(400),
      ),
    );
    for (const r of results) {
      for (const m of r.data ?? []) {
        if (!m.conversation_id || contactNoteByConv.has(m.conversation_id)) continue;
        const text = (m.content ?? "").trim();
        if (text) contactNoteByConv.set(m.conversation_id, text);
      }
    }
  }

  const items: PaymentItem[] = rows.map((r) => {
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
      contactEmail: conv?.contact_email ?? null,
      agendada: conv?.agendada ?? null,
      titleExempt: conv?.is_existing_customer === true,
      previousMasterclasses: previousMasterclasses(
        r,
        r.conversation_id ? historyByConv.get(r.conversation_id) ?? [] : [],
        new Set((membersByCanonical.get(r.id) ?? []).map((member) => member.id)),
      ),
      eventSlug: r.event_slug,
      comprobanteUrl: r.comprobante_path ? signed.get(r.comprobante_path) ?? null : null,
      comprobanteType: r.comprobante_type,
      // Un N° de operación repetido DENTRO del mismo grupo no es un doble
      // envío a avisar: es justamente lo que el grupo junta.
      isDuplicate:
        duplicateIds.has(r.id) &&
        !(membersByCanonical.get(r.id) ?? []).some(
          (m) => m.id === earliestIdByOp.get(norm(r.operation_number))?.id,
        ),
      contactHasValidatedPayment,
      // En un grupo pendiente alcanza con que una imagen esté retenida (la
      // PATCH exige forzar igual).
      awaitingTitle:
        r.status === "pending"
          ? (membersByCanonical.get(r.id) ?? [r]).some((m) => m.status === "pending" && m.awaiting_title)
          : r.awaiting_title ?? false,
      deliveryFailed: r.delivery_failed ?? false,
      deliveryError: r.delivery_error ?? null,
      courseAccessGrantedAt: r.course_access_granted_at ?? null,
      courseAccessError: displayCourseAccessError(r.course_access_error),
      titles: r.conversation_id ? titlesByConv.get(r.conversation_id) ?? [] : [],
      contactNote: r.conversation_id
        ? contactNoteByConv.get(r.conversation_id) ?? null
        : null,
      conversation: convSummary(conv),
      validatedAt: r.validated_at,
      validationNote: r.validation_note,
      validatedByName: validator?.name ?? null,
      groupImages: (membersByCanonical.get(r.id) ?? [r]).map((m) => ({
        id: m.id,
        url: m.comprobante_path ? signed.get(m.comprobante_path) ?? null : null,
        fileType: m.comprobante_type,
        createdAt: m.created_at,
        amount: m.amount === null ? null : Number(m.amount),
        operationNumber: m.operation_number,
      })),
      groupMaybeDistinct: maybeDistinctIds.has(r.id),
    };
  });

  // Casos de "título a validar" sin comprobante que los agrupe.
  const titleReviews: TitleReview[] = [];
  for (const convId of reviewConvIds) {
    const submissions = titlesByConv.get(convId) ?? [];
    if (!submissions.length) continue;
    const createdAt = submissions.map((s) => s.createdAt).sort().slice(-1)[0] ?? "";
    titleReviews.push({
      conversation: convSummary(convById.get(convId)),
      submissions,
      contactNote: contactNoteByConv.get(convId) ?? null,
      createdAt,
    });
  }
  titleReviews.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Opcional (/revision): cuántas derivaciones abiertas tiene cada conversación
  // de la lista, sin contar las de validación de pago. Si falla, la lista sale
  // igual sin el indicador.
  let interventions: Record<string, number> | undefined;
  if (req.nextUrl.searchParams.get("with") === "interventions") {
    try {
      const counts = await loadOpenTeamNotificationCounts(sb, clientEnv.NEXT_PUBLIC_CLIENT_SLUG);
      const shown = new Set<string>([...convIds, ...reviewConvIds]);
      interventions = {};
      for (const [convId, n] of counts) if (shown.has(convId)) interventions[convId] = n;
    } catch (err) {
      console.error("[payments] no se pudieron leer las intervenciones:", err);
    }
  }

  // Mismo pedido (/revision): conversaciones con el tag "Crítico" → motivo.
  // Son pocas filas; si la migración 034 no está aplicada, sale sin el dato.
  let critical: Record<string, string | null> | undefined;
  if (req.nextUrl.searchParams.get("with") === "interventions") {
    try {
      const rows = await fetchAllRows((from, to) =>
        sb
          .from("conversations")
          .select("id, critical_reason")
          .eq("client_slug", clientEnv.NEXT_PUBLIC_CLIENT_SLUG)
          .eq("critical", true)
          .order("id", { ascending: true })
          .range(from, to),
      );
      const shown = new Set<string>([...convIds, ...reviewConvIds]);
      critical = {};
      for (const r of rows) if (shown.has(r.id)) critical[r.id] = r.critical_reason ?? null;
    } catch {
      // Sin columnas critical_* (o fallo puntual): la cola sale sin el pill.
    }
  }

  return NextResponse.json({
    items,
    titleReviews,
    stats,
    ...(interventions ? { interventions } : {}),
    ...(critical ? { critical } : {}),
  });
}
