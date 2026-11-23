import * as paymentMessages from "./payments/messages";
import { TIENDUP_ACCESS_MESSAGE } from "./tiendup/messages";
import type { WhatsAppTemplate } from "./providers/ghl-templates-client";
import { WHATSAPP_TEMPLATE_BODIES } from "./whatsapp-template-bodies";

const DEFAULT_MAP = {
  PAYMENT_APPROVED_ASK_EMAIL_MESSAGE: "pago_verificado_mail",
  TITLE_VALIDATED_ASK_EMAIL_MESSAGE: "pago_verificado_mail",
  PAYMENT_APPROVED_MESSAGE: "pago_verificado",
  TITLE_VALIDATED_PAYMENT_OK_MESSAGE: "pago_verificado",
  TIENDUP_ACCESS_MESSAGE: "altatiendup",
} as const;

const fixedTexts = { ...paymentMessages, TIENDUP_ACCESS_MESSAGE };
const messageKeys = Object.keys(DEFAULT_MAP) as (keyof typeof DEFAULT_MAP)[];

export function whatsappTemplatesEnabled(value = process.env.WHATSAPP_TEMPLATES_ENABLED): boolean {
  return /^(1|true|on)$/i.test(value?.trim() ?? "");
}

export function templateNameForContent(content: string, json = process.env.WHATSAPP_TEMPLATE_MAP): string | null {
  const key = messageKeys.find((key) => fixedTexts[key] === content);
  if (!key) return null;
  try {
    const name = json ? JSON.parse(json)?.[key] : undefined;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // Si la configuración no es JSON válido, conservamos el mapeo por defecto.
  }
  return DEFAULT_MAP[key];
}

export function fixedTextVariants(content: string): string[] {
  const key = messageKeys.find((key) => fixedTexts[key] === content);
  return key ? [content, WHATSAPP_TEMPLATE_BODIES[DEFAULT_MAP[key]]] : [content];
}

export function whatsappWindowOpen(lastInboundAtIso: string | null | undefined, now: number): boolean {
  if (!lastInboundAtIso) return false;
  return now - Date.parse(lastInboundAtIso) < (24 * 60 - 10) * 60_000;
}

export function isWhatsAppWindowError(error: string): boolean {
  return /\b24(?:\s*h(?:ours?|oras?)?)?\b|window|ventana|re-?engagement|131047|outside.*session|template/i.test(error);
}

type TemplateTrigger = "ventana de 24 h cerrada" | "fallback por error de ventana";
type SendResult =
  | { messageId: string | null; template?: undefined }
  | { messageId: string; template: WhatsAppTemplate; trigger: TemplateTrigger };

export async function sendFixedWhatsApp(opts: {
  templateName: string | null;
  windowOpen: boolean;
  sendText: () => Promise<string | null>;
  resolveTemplate: (name: string) => Promise<{ template: WhatsAppTemplate | null; listed: boolean }>;
  sendTemplate: (id: string) => Promise<string>;
}): Promise<SendResult> {
  const name = opts.templateName;
  if (!name) return { messageId: await opts.sendText() };

  let trigger: TemplateTrigger = "ventana de 24 h cerrada";
  let textError: string | undefined;
  if (opts.windowOpen) {
    try {
      return { messageId: await opts.sendText() };
    } catch (err) {
      textError = err instanceof Error ? err.message : String(err);
      if (!isWhatsAppWindowError(textError)) throw err;
      trigger = "fallback por error de ventana";
    }
  }

  const { template, listed } = await opts.resolveTemplate(name);
  if (template?.usable) {
    return { messageId: await opts.sendTemplate(template.id), template, trigger };
  }
  const reason = !listed ? "no se pudo consultar" : template ? "no aprobada" : "no encontrada";
  if (!opts.windowOpen) {
    // El margen local es conservador. GHL todavía puede aceptar el texto libre.
    try {
      return { messageId: await opts.sendText() };
    } catch (err) {
      textError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`${textError}; plantilla ${name} ${reason}`);
}

export async function persistWhatsAppDelivery(
  result: SendResult,
  history: {
    markDelivered: (messageId: string | null, content?: string) => Promise<void>;
    addSystemNote: (content: string) => Promise<void>;
  },
): Promise<void> {
  await history.markDelivered(result.messageId, result.template?.body);
  if (result.template) {
    await history.addSystemNote(`Enviado con plantilla de WhatsApp ${result.template.name} (${result.trigger})`);
  }
}
