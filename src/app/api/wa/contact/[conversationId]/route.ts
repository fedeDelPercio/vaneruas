import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";
import { COMPROBANTES_BUCKET } from "@/lib/payments/storage";
import {
  KNOWN_COMPROBANTE_EVENTS,
  accesoVigenteDeEvento,
  type KnownComprobanteEvent,
} from "@/lib/payments/event-match";
import { canonicoDeAgrupado, esAgrupado, esDescartado } from "@/lib/payments/dismiss";
import { groupPendingPayments } from "@/lib/payments/grouping";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// GET /api/wa/contact/[conversationId]
//
// Ficha del contacto para el chat: todo lo que nos llegó de esa persona,
// agrupado por evento (comprobante, pago, acceso al curso), más su título
// profesional, sus reclamos de certificado y las derivaciones al equipo.
//
// Orden de los eventos: primero los que están en venta (status "activo" en
// /events), aunque la persona todavía no haya mandado nada para ellos (así se
// ve de un vistazo "todavía no pagó la que está abierta"); después los pasados
// en los que sí tiene algo, del más nuevo al más viejo.
// ===========================================================================

export type PaymentStage = "none" | "pending" | "awaiting_title" | "validated" | "rejected";
export type AccessStage = "not_applicable" | "waiting_payment" | "missing" | "missing_email" | "granted" | "closed";

export interface ContactEvent {
  key: string;
  title: string;
  kind: "masterclass" | "congreso" | "otro";
  /** Fecha del evento (ISO) si está cargado en /events. */
  eventAt: string | null;
  /** En venta hoy. */
  active: boolean;
  payment: {
    stage: PaymentStage;
    amount: number | null;
    currency: string | null;
    /** Cuándo entró el comprobante que define el estado. */
    receivedAt: string | null;
    validatedAt: string | null;
    /** Comprobantes reales recibidos para este evento (sin los descartados). */
    count: number;
    /** Comprobantes aprobados (más de uno si pagó en partes). */
    validatedCount: number;
    /** Comprobantes que siguen sin revisar aunque ya haya uno aprobado. */
    extraPending: number;
    /** No se le pudo avisar por WhatsApp que el pago quedó aprobado. */
    deliveryFailed: boolean;
  };
  access: {
    stage: AccessStage;
    grantedAt: string | null;
    /** Motivo del último intento de alta en Tiendup que no salió (null = ninguno). */
    error: string | null;
  };
}

/**
 * Un archivo que mandó la persona (comprobante o título), para verlo y
 * resolverlo desde la ficha. `url` es una signed URL de vida corta.
 */
export interface ContactFile {
  id: string;
  kind: "comprobante" | "titulo";
  url: string | null;
  fileType: string | null;
  createdAt: string;
  /**
   * Comprobante: pending / awaiting_title / validated / rejected / dismissed.
   * Título: valid / review / rejected.
   */
  status: string;
  /** Comprobante: evento al que se asignó (slug) y monto leído. */
  eventSlug: string | null;
  amount: number | null;
  currency: string | null;
  /** Título: nombre e institución leídos. */
  titleName: string | null;
  institution: string | null;
  /**
   * Comprobante: todas las imágenes del mismo pago (grouping.ts), incluida la
   * propia, de la más vieja a la más nueva. Ausente o de una = sin grupo.
   */
  images?: { id: string; url: string | null; fileType: string | null; createdAt: string }[];
  /** Montos leídos distintos dentro del grupo ("parecen pagos distintos"). */
  maybeDistinct?: boolean;
}

export interface ContactFicha {
  conversation: {
    id: string;
    displayName: string;
    phone: string | null;
    email: string | null;
    externalId: string | null;
    source: string;
    mode: "AI" | "HUMAN";
    isCustomer: boolean;
    agendada: boolean;
    createdAt: string;
  };
  events: ContactEvent[];
  title: {
    stage: "none" | "valid" | "review" | "rejected";
    titleName: string | null;
    institution: string | null;
    at: string | null;
  };
  certificados: { id: string; summary: string | null; createdAt: string; resolvedAt: string | null }[];
  derivaciones: { id: string; category: string; summary: string | null; createdAt: string; resolvedAt: string | null }[];
  /** Comprobantes (incluidos los descartados) y títulos, del más nuevo al más viejo. */
  files: ContactFile[];
}

const SIGNED_URL_TTL_SECONDS = 600;

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }
  const sb = getSupabaseServerClient();

  const [convRes, payRes, titleRes, notifRes, eventsRes] = await Promise.all([
    sb.from("conversations").select("*").eq("id", conversationId).maybeSingle(),
    sb
      .from("payment_validations")
      .select(
        "id, amount, currency, event_slug, status, awaiting_title, delivery_failed, course_access_granted_at, course_access_error, validated_at, validation_note, contact_email, operation_number, comprobante_path, comprobante_type, created_at",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    sb
      .from("professional_titles")
      .select("id, title_name, institution, is_valid, reviewed_at, file_path, file_type, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }),
    sb
      .from("agent_notifications")
      .select("id, category, summary, created_at, resolved_at")
      .eq("conversation_id", conversationId)
      .neq("category", "validacion_pago")
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("events").select("id, title, kind, status, event_at"),
  ]);

  // Si falla cualquiera de las lecturas, error: mostrar "Todavía no lo envió"
  // cuando en realidad no se pudo leer sería afirmar algo falso.
  const failed = [convRes, payRes, titleRes, notifRes, eventsRes].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  const conv = convRes.data;
  if (!conv) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  // Activos primero y, dentro de cada grupo, el más nuevo: si dos eventos
  // comparten palabra clave (una edición archivada y la que está en venta),
  // los comprobantes se asocian a la que está en venta.
  const eventRows = (eventsRes.data ?? []).slice().sort((a, b) => {
    const aActive = a.status === "activo";
    const bActive = b.status === "activo";
    if (aActive !== bActive) return aActive ? -1 : 1;
    return (b.event_at ?? "").localeCompare(a.event_at ?? "");
  });
  const eventRowFor = (known: KnownComprobanteEvent) =>
    eventRows.find((e) => normalize(e.title).includes(normalize(known.titleKeyword))) ?? null;

  const email = conv.contact_email?.trim() || null;

  // Grupos (grouping.ts): varias imágenes del mismo pago cuentan como UN
  // comprobante. Pendientes: solo el canónico; resueltos: las imágenes extra
  // quedaron con la nota de agrupado y se cuelgan de su canónico.
  const rawPayments = payRes.data ?? [];
  const membersByCanonical = new Map<string, typeof rawPayments>();
  const maybeDistinctIds = new Set<string>();
  const hiddenIds = new Set<string>();
  for (const g of groupPendingPayments(rawPayments.map((p) => ({ ...p, conversation_id: conversationId })))) {
    const members = g.members.map((m) => rawPayments.find((p) => p.id === m.id)!);
    membersByCanonical.set(g.canonical.id, members);
    if (g.maybeDistinct) maybeDistinctIds.add(g.canonical.id);
    for (const m of g.members) if (m.id !== g.canonical.id) hiddenIds.add(m.id);
  }
  for (const p of rawPayments) {
    const canonicalId = canonicoDeAgrupado(p);
    if (!canonicalId) continue;
    hiddenIds.add(p.id);
    const canonical = rawPayments.find((x) => x.id === canonicalId);
    if (!canonical) continue;
    const arr = membersByCanonical.get(canonicalId) ?? [canonical];
    arr.push(p);
    membersByCanonical.set(canonicalId, arr);
  }
  for (const arr of membersByCanonical.values()) arr.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const payments = rawPayments.filter((p) => !esDescartado(p) && !esAgrupado(p) && !hiddenIds.has(p.id));

  function buildEvent(
    key: string,
    title: string,
    kind: ContactEvent["kind"],
    eventAt: string | null,
    active: boolean,
    slug: string | null,
  ): ContactEvent {
    const own = payments.filter((p) => (p.event_slug ?? null) === slug);
    // El comprobante que define el estado: el aprobado si hay uno; si no, el
    // que está esperando; si no, el último rechazado.
    const validatedAll = own.filter((p) => p.status === "validated");
    const pendingAll = own.filter((p) => p.status === "pending");
    const validated = validatedAll[0];
    const pending = pendingAll[pendingAll.length - 1];
    const rejected = own.filter((p) => p.status === "rejected").pop();
    const main = validated ?? pending ?? rejected ?? null;
    const stage: PaymentStage = validated
      ? "validated"
      : pending
        ? // Retenido si CUALQUIERA de los pendientes espera el título.
          pendingAll.some((p) => p.awaiting_title)
          ? "awaiting_title"
          : "pending"
        : rejected
          ? "rejected"
          : "none";

    // Monto aprobado: la suma de los comprobantes validados (hay quien paga en
    // dos transferencias), sin contar dos veces un mismo N° de operación (el
    // mismo comprobante aprobado dos veces).
    let amount = main?.amount ?? null;
    let validatedCount = 0;
    if (validated) {
      const seenOps = new Set<string>();
      let sum = 0;
      let withAmount = 0;
      for (const p of validatedAll) {
        const op = (p.operation_number ?? "").trim().toUpperCase();
        if (op && seenOps.has(op)) continue;
        if (op) seenOps.add(op);
        validatedCount++;
        if (p.amount !== null) {
          sum += Number(p.amount);
          withAmount++;
        }
      }
      amount = withAmount ? sum : null;
    }

    let access: ContactEvent["access"] = { stage: "not_applicable", grantedAt: null, error: null };
    if (kind === "masterclass") {
      const granted = own.find((p) => p.course_access_granted_at);
      // Motivo del alta que no salió (otro correo en Tiendup, falla, etc.).
      const error =
        validatedAll.map((p) => p.course_access_error?.trim() || null).find(Boolean) ?? null;
      if (granted) {
        access = { stage: "granted", grantedAt: granted.course_access_granted_at, error: null };
      } else if (!validated) {
        access = { stage: "waiting_payment", grantedAt: null, error: null };
      } else if (slug && !accesoVigenteDeEvento(slug)) {
        access = { stage: "closed", grantedAt: null, error: null };
      } else if (!email && !validated.contact_email) {
        access = { stage: "missing_email", grantedAt: null, error };
      } else {
        access = { stage: "missing", grantedAt: null, error };
      }
    }

    return {
      key,
      title,
      kind,
      eventAt,
      active,
      payment: {
        stage,
        amount,
        currency: (validatedAll.find((p) => p.currency) ?? main)?.currency ?? null,
        receivedAt: main?.created_at ?? null,
        validatedAt: validated?.validated_at ?? null,
        count: own.length,
        validatedCount,
        extraPending: validated ? pendingAll.length : 0,
        deliveryFailed: Boolean(validated?.delivery_failed),
      },
      access,
    };
  }

  const events: ContactEvent[] = [];
  const usedEventIds = new Set<string>();
  for (const known of KNOWN_COMPROBANTE_EVENTS) {
    const row = eventRowFor(known);
    if (row) usedEventIds.add(row.id);
    const active = row?.status === "activo";
    const hasData = payments.some((p) => p.event_slug === known.slug);
    if (!active && !hasData) continue;
    events.push(
      buildEvent(
        known.slug,
        row?.title ?? known.label,
        known.slug === "congreso" ? "congreso" : "masterclass",
        row?.event_at ?? null,
        active,
        known.slug,
      ),
    );
  }
  // Eventos activos cargados en /events que todavía no tienen monto conocido
  // en event-match: se muestran igual, sin datos de pago.
  for (const row of eventRows) {
    if (usedEventIds.has(row.id) || row.status !== "activo") continue;
    events.push({
      key: row.id,
      title: row.title,
      kind: row.kind === "masterclass" ? "masterclass" : row.kind === "congress" ? "congreso" : "otro",
      eventAt: row.event_at,
      active: true,
      payment: { stage: "none", amount: null, currency: null, receivedAt: null, validatedAt: null, count: 0, validatedCount: 0, extraPending: 0, deliveryFailed: false },
      access: { stage: "not_applicable", grantedAt: null, error: null },
    });
  }
  // Comprobantes viejos sin evento identificado.
  if (payments.some((p) => !p.event_slug)) {
    events.push(buildEvent("sin-evento", "Comprobante sin evento identificado", "otro", null, false, null));
  }
  events.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.eventAt ?? "").localeCompare(a.eventAt ?? "");
  });

  // Título profesional: manda el último veredicto favorable; si no hay, el
  // último envío.
  const titles = titleRes.data ?? [];
  const validTitle = titles.find((t) => t.is_valid);
  const lastTitle = titles[0] ?? null;
  const title: ContactFicha["title"] = validTitle
    ? { stage: "valid", titleName: validTitle.title_name, institution: validTitle.institution, at: validTitle.created_at }
    : lastTitle
      ? {
          stage: lastTitle.reviewed_at ? "rejected" : "review",
          titleName: lastTitle.title_name,
          institution: lastTitle.institution,
          at: lastTitle.created_at,
        }
      : { stage: "none", titleName: null, institution: null, at: null };

  // Archivos para ver y resolver desde la ficha. Firmados de una vez (el
  // bucket es privado); los paths salen de filas que RLS ya filtró por cliente.
  // Las imágenes extra de un grupo van dentro de su canónico, no sueltas.
  const allPayments = rawPayments.filter((p) => !hiddenIds.has(p.id));
  const paths = [
    ...rawPayments.map((p) => p.comprobante_path),
    ...titles.map((t) => t.file_path),
  ].filter((x): x is string => Boolean(x));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await getSupabaseAdminClient()
      .storage.from(COMPROBANTES_BUCKET)
      .createSignedUrls(Array.from(new Set(paths)), SIGNED_URL_TTL_SECONDS);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl && !u.error) signed.set(u.path, u.signedUrl);
    }
  }
  const files: ContactFile[] = [
    ...allPayments.map((p) => ({
      id: p.id,
      kind: "comprobante" as const,
      url: p.comprobante_path ? signed.get(p.comprobante_path) ?? null : null,
      fileType: p.comprobante_type ?? null,
      createdAt: p.created_at,
      status: esDescartado(p)
        ? "dismissed"
        : p.status === "pending" &&
            (membersByCanonical.get(p.id) ?? [p]).some((m) => m.status === "pending" && m.awaiting_title)
          ? "awaiting_title"
          : p.status,
      eventSlug: p.event_slug ?? null,
      amount: p.amount === null ? null : Number(p.amount),
      currency: p.currency ?? null,
      titleName: null,
      institution: null,
      images: (membersByCanonical.get(p.id) ?? [p]).map((m) => ({
        id: m.id,
        url: m.comprobante_path ? signed.get(m.comprobante_path) ?? null : null,
        fileType: m.comprobante_type ?? null,
        createdAt: m.created_at,
      })),
      maybeDistinct: maybeDistinctIds.has(p.id),
    })),
    ...titles.map((t) => ({
      id: t.id,
      kind: "titulo" as const,
      url: t.file_path ? signed.get(t.file_path) ?? null : null,
      fileType: t.file_type ?? null,
      createdAt: t.created_at,
      status: t.is_valid ? "valid" : t.reviewed_at ? "rejected" : "review",
      eventSlug: null,
      amount: null,
      currency: null,
      titleName: t.title_name ?? null,
      institution: t.institution ?? null,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const notifs = notifRes.data ?? [];
  const ficha: ContactFicha = {
    conversation: {
      id: conv.id,
      displayName: conv.display_name?.trim() || "(sin nombre)",
      phone: conv.wa_jid,
      email,
      externalId: conv.external_id,
      source: conv.source,
      mode: conv.mode === "HUMAN" ? "HUMAN" : "AI",
      isCustomer: conv.is_existing_customer,
      agendada: conv.agendada,
      createdAt: conv.created_at,
    },
    events,
    title,
    certificados: notifs
      .filter((n) => n.category === "reclamo_certificado")
      .map((n) => ({ id: n.id, summary: n.summary, createdAt: n.created_at, resolvedAt: n.resolved_at })),
    derivaciones: notifs
      .filter((n) => n.category !== "reclamo_certificado")
      .map((n) => ({ id: n.id, category: n.category, summary: n.summary, createdAt: n.created_at, resolvedAt: n.resolved_at })),
    files,
  };
  return NextResponse.json(ficha);
}
