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
  conversation: { id: string; displayName: string; source: string } | null;
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
    .order("created_at", { ascending: false })
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
    ? await sb.from("conversations").select("id, display_name, source").in("id", convIds)
    : { data: [] };
  const convById = new Map((convs ?? []).map((c) => [c.id, c]));

  // Resolver validadores.
  const validatorIds = Array.from(
    new Set(rows.map((r) => r.validated_by).filter(Boolean) as string[]),
  );
  const { data: validators } = validatorIds.length
    ? await sb.from("profiles").select("id, name").in("id", validatorIds)
    : { data: [] };
  const validatorById = new Map((validators ?? []).map((p) => [p.id, p]));

  // Signed URLs (en paralelo) para mostrar los comprobantes.
  const signedUrls = await Promise.all(
    rows.map((r) =>
      r.comprobante_path ? getComprobanteSignedUrl(r.comprobante_path) : Promise.resolve(null),
    ),
  );

  const items: PaymentItem[] = rows.map((r, i) => {
    const conv = r.conversation_id ? convById.get(r.conversation_id) : null;
    const validator = r.validated_by ? validatorById.get(r.validated_by) : null;
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
      contactEmail: r.contact_email,
      eventSlug: r.event_slug,
      comprobanteUrl: signedUrls[i] ?? null,
      comprobanteType: r.comprobante_type,
      conversation: conv
        ? { id: conv.id, displayName: conv.display_name ?? "(sin nombre)", source: conv.source }
        : null,
      validatedAt: r.validated_at,
      validationNote: r.validation_note,
      validatedByName: validator?.name ?? null,
    };
  });

  return NextResponse.json({ items });
}
