import "server-only";

import nodemailer from "nodemailer";
import { serverEnv, clientEnv } from "@/lib/env";

// ===========================================================================
// Email sender via Gmail SMTP + App Password.
//
// La cuenta Gmail tiene que tener 2FA activado y una App Password generada
// en https://myaccount.google.com/apppasswords. Limite informal de Gmail:
// ~500 mails/dia para cuentas free. Suficiente para notificaciones de un
// cliente chico.
//
// Si faltan env vars (GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_NOTIFY_TO) el
// envio se loggea como skipped y la app sigue. No bloquea el flow del
// agente, asi clientes que todavia no configuraron email pueden correr.
//
// Notificacion GENERICA: dispara en cada `agent_notifications` nueva, sin
// depender de la tabla `leads` (que es opcional por cliente). El payload
// trae solo lo que vive en agent_notifications + el id de conversacion
// para armar el deep link al panel.
// ===========================================================================

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const env = serverEnv();
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  return cachedTransporter;
}

export interface TeamNotificationPayload {
  category: string;
  reason: string | null;
  summary: string | null;
  conversationId: string;
  /** "test", "whatsapp", etc. Determina el path del deep link al panel. */
  conversationSource: string | null;
  /** Id del comprobante (categoría validacion_pago): deep link a /payments. */
  paymentId?: string | null;
}

/** Humaniza una categoría snake_case en algo legible para el email. */
function humanizeCategory(c: string): string {
  return c
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Encabezado del email + asunto adaptado a la categoría. El operador que
// lo lee tiene que entender de UN vistazo qué pasó sin jerga técnica ni
// rótulos engañosos ("Nueva notificación" cuando en realidad es una
// consulta que la IA no supo responder).
//
// - eyebrow: línea chiquita encima de la categoría, mono mayúsculas.
// - subjectPrefix: lo que va antes del nombre de la categoría en el subject.
// - summaryHeading: el label de la sección "qué pasó" en el cuerpo.
//
// Los clientes que tengan categorías propias (interes_compra,
// arquitecto_desarrollador, etc.) las suman a esta tabla. Default seguro
// para categorías desconocidas: "Conversación a revisar".
const CATEGORY_PRESENTATION: Record<
  string,
  { eyebrow: string; subjectPrefix: string; summaryHeading: string }
> = {
  interes_compra: {
    eyebrow: "Nuevo lead",
    subjectPrefix: "Nuevo lead",
    summaryHeading: "Resumen del agente",
  },
  visita_obra: {
    eyebrow: "Pedido de visita",
    subjectPrefix: "Pedido de visita",
    summaryHeading: "Resumen del agente",
  },
  consulta_financiacion: {
    eyebrow: "Consulta de financiación",
    subjectPrefix: "Consulta de financiación",
    summaryHeading: "Resumen del agente",
  },
  cliente_existente: {
    eyebrow: "Cliente existente",
    subjectPrefix: "Cliente existente",
    summaryHeading: "Resumen del agente",
  },
  fuera_de_conocimiento: {
    eyebrow: "Consulta para responder",
    subjectPrefix: "Consulta para responder",
    summaryHeading: "Resumen de la conversación",
  },
  escalado_manual: {
    eyebrow: "Conversación a revisar",
    subjectPrefix: "Conversación a revisar",
    summaryHeading: "Resumen de la conversación",
  },
  validacion_pago: {
    eyebrow: "Comprobante de pago",
    subjectPrefix: "Comprobante de pago",
    summaryHeading: "Datos del comprobante",
  },
  reclamo_certificado: {
    eyebrow: "Reclamo de certificado",
    subjectPrefix: "Reclamo de certificado",
    summaryHeading: "Resumen del reclamo",
  },
};

function presentation(c: string): {
  eyebrow: string;
  subjectPrefix: string;
  summaryHeading: string;
} {
  return (
    CATEGORY_PRESENTATION[c] ?? {
      eyebrow: "Conversación a revisar",
      subjectPrefix: "Conversación a revisar",
      summaryHeading: "Resumen de la conversación",
    }
  );
}

function buildActionUrl(p: TeamNotificationPayload): string {
  const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  // Comprobantes de pago: el equipo entra directo a /payments a aprobar o
  // rechazar (con el id para resaltar el comprobante puntual).
  if (p.category === "validacion_pago") {
    return p.paymentId ? `${base}/payments?id=${p.paymentId}` : `${base}/payments`;
  }
  // Por defecto el template solo tiene /conversations. Clientes con
  // WhatsApp (que monten src/app/(dashboard)/wa) deep-linkean a /wa si
  // la conversación es de ese canal.
  const path = p.conversationSource === "whatsapp" ? "/wa" : "/conversations";
  return `${base}${path}?id=${p.conversationId}`;
}

/** Texto del botón CTA según la categoría. */
function ctaLabel(category: string): string {
  return category === "validacion_pago"
    ? "Aprobar o rechazar el pago"
    : "Ver conversación";
}

function buildHtml(p: TeamNotificationPayload): string {
  const url = buildActionUrl(p);
  const category = humanizeCategory(p.category);
  const pres = presentation(p.category);
  const summary = p.summary?.trim() ?? "Sin resumen.";
  const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const logoUrl = `${base}/brand-logo.png`;

  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#171717;border:1px solid #262626;border-radius:8px;color:#fafafa;">
          <tr>
            <td align="center" style="padding:32px 24px 0 24px;">
              <img src="${logoUrl}" alt="" style="max-height:72px;width:auto;display:inline-block;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 24px 12px 24px;">
              <p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#737373;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
                ${pres.eyebrow}
              </p>
              <h1 style="margin:8px 0 0 0;font-size:18px;font-weight:500;letter-spacing:-0.015em;color:#fafafa;">
                ${category}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px;">
              <div style="height:1px;background:#262626;"></div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 24px;font-size:13px;color:#d4d4d4;line-height:1.6;">
              <p style="margin:0 0 6px 0;">
                <span style="color:#737373;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${pres.summaryHeading}</span><br/>
                <span style="color:#e5e5e5;">${summary.replace(/\n/g, "<br/>")}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:12px 24px 28px 24px;">
              <a href="${url}" style="display:inline-block;background:#fafafa;color:#0a0a0a;text-decoration:none;font-size:13px;font-weight:500;padding:10px 18px;border-radius:6px;">
                ${ctaLabel(p.category)}
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#737373;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;">
          Agentic Panel · ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText(p: TeamNotificationPayload): string {
  const url = buildActionUrl(p);
  const category = humanizeCategory(p.category);
  const pres = presentation(p.category);
  return [
    `${pres.eyebrow} — ${category}`,
    "",
    `${pres.summaryHeading}:`,
    p.summary?.trim() ?? "Sin resumen.",
    "",
    `${ctaLabel(p.category)}: ${url}`,
  ].join("\n");
}

/**
 * Manda un email al equipo avisando de una notificación nueva del agente.
 * Si las env vars (GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_NOTIFY_TO) no
 * estan configuradas, loggea skip y retorna sin error.
 */
export async function sendTeamNotificationAlert(
  payload: TeamNotificationPayload,
): Promise<void> {
  const env = serverEnv();
  const to = env.EMAIL_NOTIFY_TO;
  const transporter = getTransporter();

  if (!transporter || !to) {
    console.log("[email] sendTeamNotificationAlert skipped (env vars faltantes)");
    return;
  }

  try {
    const pres = presentation(payload.category);
    await transporter.sendMail({
      from: env.GMAIL_USER,
      to,
      subject: `${pres.subjectPrefix}: ${humanizeCategory(payload.category)}`,
      text: buildText(payload),
      html: buildHtml(payload),
    });
  } catch (err) {
    console.error("[email] no se pudo enviar el email de notificación:", err);
  }
}
