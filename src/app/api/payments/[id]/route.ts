import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { deliverAssistantToWhatsApp } from "@/lib/whatsapp-delivery";
import { autoEnrollPayment } from "@/lib/tiendup/auto-enroll";
import { resolvePaymentNotificationsIfDone } from "@/lib/interventions";
import { findGroupOf } from "@/lib/payments/grouping";
import { mergedNote } from "@/lib/payments/dismiss";
import { approvalMessage } from "@/lib/payments/email-ask";
import {
  emailAlreadyAsked,
  paymentPeriodStart,
  resolveConversationEmail,
} from "@/lib/payments/email-request";

export const dynamic = "force-dynamic";
// El alta automática corre en after() y reintenta errores de Tiendup (tope 35 s).
export const maxDuration = 60;

// Confirmación que recibe la profesional cuando su pago queda aprobado: textos
// en src/lib/payments/messages.ts. Si ya tenemos su correo, la de siempre
// ("En breve te enviamos el acceso a tu correo"); si no, la misma confirmación
// pidiendo el correo en el mismo mensaje. Es el ÚNICO momento en que se pide
// el correo (con todo aprobado), y una sola vez por pago (email-ask.ts).

// ===========================================================================
// PATCH /api/payments/[id]
//
// Marca un comprobante como validado o rechazado. El equipo lo dispara desde el
// panel tras chequear el pago contra su contabilidad. Guarda quién lo validó
// (validated_by) y cuándo, más una nota opcional. RLS asegura que solo se
// puedan tocar filas del cliente activo.
//
// Grupos (src/lib/payments/grouping.ts): varias imágenes pendientes del mismo
// pago se resuelven JUNTAS en una sola operación (`group`, por defecto true):
//   - validated: este comprobante queda validated; los demás del grupo,
//     rejected con la nota de agrupado (no son un rechazo, ver dismiss.ts).
//   - rejected (o descartado): todos rejected con la misma nota.
//   - pending: vuelve este y las imágenes que se habían agrupado con él.
// El aviso por WhatsApp, el alta en Tiendup y el cierre de validacion_pago
// corren UNA sola vez, sobre este comprobante. El panel manda siempre el id
// del canónico que calculó GET /api/payments.
// ===========================================================================

const patchSchema = z.object({
  status: z.enum(["validated", "rejected", "pending"]),
  note: z.string().max(2000).optional().nullable(),
  validatedBy: z.string().uuid().optional().nullable(),
  // Forzar la aprobación de un comprobante retenido aunque la contacta no haya
  // acreditado su título profesional (ej. el equipo decide habilitarlo igual).
  force: z.boolean().optional(),
  // Resolver también las demás imágenes pendientes del mismo pago (default).
  group: z.boolean().optional(),
});

const GROUP_COLS = "id, conversation_id, event_slug, status, amount, operation_number, created_at, awaiting_title";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { status, note, validatedBy, force, group = true } = parsed.data;
  const sb = getSupabaseServerClient();

  // Estado previo: para confirmar por WhatsApp solo en la transición a
  // 'validated' (no reenviar si ya estaba aprobado).
  const { data: prev } = await sb
    .from("payment_validations")
    .select("status, conversation_id, awaiting_title, event_slug")
    .eq("id", id)
    .maybeSingle();

  // Hermanos del grupo: las otras imágenes pendientes del mismo pago.
  let siblings: { id: string; awaiting_title: boolean }[] = [];
  if (group && prev?.conversation_id && prev.status === "pending" && status !== "pending") {
    const { data: pend, error: pendErr } = await sb
      .from("payment_validations")
      .select(GROUP_COLS)
      .eq("conversation_id", prev.conversation_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (pendErr) {
      return NextResponse.json({ error: pendErr.message }, { status: 500 });
    }
    const g = findGroupOf(pend ?? [], id);
    siblings = (g?.members ?? [])
      .filter((m) => m.id !== id)
      .map((m) => ({ id: m.id, awaiting_title: m.awaiting_title }));
  }

  // Un comprobante retenido (esperando el título profesional) no se puede
  // aprobar por la vía normal: o se valida el título (que lo libera) o el equipo
  // FUERZA la aprobación explícitamente (force=true). Sin force, devolvemos 409.
  // En un grupo, alcanza con que una imagen esté retenida.
  const heldInGroup = Boolean(prev?.awaiting_title) || siblings.some((s) => s.awaiting_title);
  const forcing = status === "validated" && heldInGroup && force === true;
  if (status === "validated" && heldInGroup && !forcing) {
    return NextResponse.json(
      {
        error:
          "Este comprobante está esperando la validación del título profesional. Validá el título o forzá la aprobación.",
      },
      { status: 409 },
    );
  }

  // Si vuelve a 'pending' se limpia la validación; si se valida/rechaza se sella.
  // Al forzar la aprobación, además se libera el retén (awaiting_title=false).
  const isResolved = status !== "pending";
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("payment_validations")
    .update({
      status,
      validation_note: note ?? null,
      validated_by: isResolved ? validatedBy ?? null : null,
      validated_at: isResolved ? nowIso : null,
      ...(forcing ? { awaiting_title: false } : {}),
      updated_at: nowIso,
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "No se encontró el comprobante" },
      { status: error ? 500 : 404 },
    );
  }

  // Resto del grupo, en una sola escritura. Al aprobar quedan "agrupados" (no
  // rechazados: ni aviso, ni métricas, ni ficha); al rechazar o descartar, con
  // la misma nota que el canónico. Solo se tocan filas que siguen pending.
  const merged: string[] = [];
  if (siblings.length) {
    const ids = siblings.map((s) => s.id);
    const { error: sibErr } = await sb
      .from("payment_validations")
      .update({
        status: "rejected",
        validation_note: status === "validated" ? mergedNote(id) : note ?? null,
        validated_by: validatedBy ?? null,
        validated_at: nowIso,
        ...(forcing ? { awaiting_title: false } : {}),
        updated_at: nowIso,
      })
      .in("id", ids)
      .eq("status", "pending");
    if (sibErr) {
      console.error("[payments] no se pudo resolver el resto del grupo:", sibErr.message);
    } else {
      merged.push(...ids);
    }
  }

  // Volver a pendiente: las imágenes que se habían agrupado con este vuelven
  // con él (si no, quedaban colgadas de un comprobante que ya no está aprobado).
  if (status === "pending" && prev?.status === "validated") {
    await sb
      .from("payment_validations")
      .update({ status: "pending", validation_note: null, validated_by: null, validated_at: null, updated_at: nowIso })
      .eq("status", "rejected")
      .eq("validation_note", mergedNote(id));
  }

  // Al aprobar: avisar a la profesional por su canal (WhatsApp en prod, panel
  // en test). El mensaje se persiste en `messages` (system of record) y el
  // provider se encarga de la entrega externa.
  // Al forzar la aprobación damos por acreditada a la contacta (no la volvemos a
  // frenar en el gate de título en próximos comprobantes de esta conversación).
  if (forcing && prev?.conversation_id) {
    await sb
      .from("conversations")
      .update({ is_existing_customer: true, updated_at: nowIso })
      .eq("id", prev.conversation_id);
  }

  let deliveryFailed = false;
  let askedEmail = false;
  if (
    status === "validated" &&
    prev?.status !== "validated" &&
    prev?.conversation_id
  ) {
    try {
      // ¿Tenemos a dónde mandarle el acceso? Si no, se lo pedimos en ESTE
      // mensaje (el gate ya pasó: si estaba retenido, 409 o forzado). Nunca
      // dos pedidos por el mismo pago.
      const email = await resolveConversationEmail(sb, prev.conversation_id);
      const alreadyAsked = email
        ? true
        : await emailAlreadyAsked(
            sb,
            prev.conversation_id,
            await paymentPeriodStart(sb, {
              conversationId: prev.conversation_id,
              eventSlug: prev.event_slug ?? null,
              paymentId: id,
            }),
          );
      const { content: message, asksEmail } = approvalMessage({
        hasEmail: Boolean(email),
        alreadyAsked,
      });
      askedEmail = asksEmail;

      const { data: inserted } = await sb
        .from("messages")
        .insert({
          conversation_id: prev.conversation_id,
          role: "assistant",
          content: message,
        })
        .select("id")
        .single();
      await sb
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", prev.conversation_id);
      // Entrega real al WhatsApp del contacto (vía GHL) si corresponde: respeta
      // GHL_SEND_ALLOWLIST y el modo Humano (skipped), y la ventana de 24 h
      // vuelve como failed.
      const delivery = await deliverAssistantToWhatsApp({
        conversationId: prev.conversation_id,
        messageId: inserted?.id,
        content: message,
      });
      // Si NO se pudo avisar al cliente (típico: ventana de 24h de WhatsApp
      // vencida), lo marcamos en el comprobante para que el equipo lo vea en
      // Aprobaciones e intervenga a mano. Si se envió (o se omitió por test /
      // modo humano), limpiamos cualquier marca previa.
      deliveryFailed = delivery.status === "failed";
      await sb
        .from("payment_validations")
        .update(
          deliveryFailed
            ? { delivery_failed: true, delivery_error: delivery.error ?? null }
            : { delivery_failed: false, delivery_error: null },
        )
        .eq("id", id);
    } catch (err) {
      console.error("[payments] no se pudo enviar la confirmación al cliente:", err);
      // No pudimos ni siquiera intentar la entrega: marcamos para revisión manual.
      deliveryFailed = true;
      await sb
        .from("payment_validations")
        .update({
          delivery_failed: true,
          delivery_error: err instanceof Error ? err.message : "error desconocido",
        })
        .eq("id", id);
    }
  }

  // Validado, rechazado o descartado: si a la conversación no le queda ningún
  // comprobante pendiente, se cierran sus notificaciones de pago (si no,
  // quedaban abiertas para siempre e inflaban "Intervención" en /wa). Una
  // sola vez, después de resolver todo el grupo.
  if (isResolved && prev?.conversation_id) {
    await resolvePaymentNotificationsIfDone(sb, prev.conversation_id, validatedBy ?? null);
  }

  // Alta automática en Tiendup (si corresponde): corre después de responder,
  // así la aprobación nunca espera ni falla por Tiendup. Solo el canónico.
  if (status === "validated" && prev?.status !== "validated") {
    after(() => autoEnrollPayment(id, { trigger: "pago validado" }));
  }

  return NextResponse.json(
    { id: data.id, status, deliveryFailed, askedEmail, merged },
    { status: 200 },
  );
}
