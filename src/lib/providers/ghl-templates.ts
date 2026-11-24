import "server-only";

import { mappedWhatsAppTemplateNames } from "@/lib/whatsapp-templates";
import { createWhatsAppTemplatesClient } from "./ghl-templates-client";

// Los nombres del catálogo son identificadores de plantilla. Los valores con
// formato inesperado se omiten, igual que los cuerpos devueltos por GHL.
export function templateLogName(value: string): string {
  return /^[a-z][a-z0-9_-]{0,79}$/i.test(value) ? withoutToken(value) : "[omitido]";
}

function withoutToken(value: string): string {
  const token = process.env.GHL_API_KEY;
  return token && value.includes(token) ? "[omitido]" : value;
}

export function templateLogStatus(value: string | null): string | null {
  if (value === null) return null;
  return /^[a-z _-]{0,60}$/i.test(value) ? withoutToken(value) : "[omitido]";
}

export const { listWhatsAppTemplates, resolveTemplate, ghlSendWhatsAppTemplate } =
  createWhatsAppTemplatesClient({
    token: process.env.GHL_API_KEY,
    locationId: process.env.NEXT_PUBLIC_GHL_LOCATION_ID,
    assumeApproved: process.env.WHATSAPP_TEMPLATES_ASSUME_APPROVED,
    onCatalogFetch: (result) => {
      const templates = result.ok ? result.templates : [];
      const mapped = mappedWhatsAppTemplateNames().map((name) => {
        const match = templates.find((item) => item.name.toLowerCase() === name.toLowerCase());
        return { nombre: templateLogName(name), encontrada: Boolean(match), estado: templateLogStatus(match?.status ?? null), usable: match?.usable ?? false };
      });
      console.warn(`[ghl-templates] catálogo ${JSON.stringify({
        ...(!result.ok && { motivo: result.failure, http: result.httpStatus, versiones: result.versions }),
        cantidad: templates.length, mapeadas: mapped,
      })}`);
    },
  });
