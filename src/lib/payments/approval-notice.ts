import "server-only";

import { openSystemNotification, resolveSystemNotification } from "@/lib/system-notifications";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { DeliveryResult } from "@/lib/whatsapp-delivery";
import { isWhatsAppWindowError, whatsappTemplatesEnabled } from "@/lib/whatsapp-templates";
import { APPROVAL_NOTICE_FAILED_PREFIX } from "./messages";

export async function updateApprovalNoticeNotification(
  sb: ReturnType<typeof getSupabaseServerClient>,
  args: { conversationId: string; paymentId: string; delivery: DeliveryResult },
): Promise<void> {
  if (!whatsappTemplatesEnabled()) return;

  const { conversationId, paymentId, delivery } = args;
  const reason = `${APPROVAL_NOTICE_FAILED_PREFIX}${paymentId}`;
  try {
    if (delivery.status === "sent") {
      await resolveSystemNotification(sb, conversationId, reason);
    } else if (delivery.status === "failed") {
      const error = delivery.error ?? "";
      const detail = isWhatsAppWindowError(error) && /plantilla .+ no (aprobada|encontrada|se pudo consultar)/i.test(error)
        ? " (ventana de 24 h cerrada y sin plantilla aprobada)"
        : "";
      await openSystemNotification(sb, {
        conversationId,
        paymentId,
        reason,
        summary: `Se aprobó el pago, pero no se le pudo avisar por WhatsApp${detail}. Avisale a mano`,
      });
    }
  } catch (err) {
    console.error("[payments] no se pudo actualizar la notificación del aviso:", err);
  }
}
