import "server-only";

import { createWhatsAppTemplatesClient } from "./ghl-templates-client";

export const { listWhatsAppTemplates, resolveTemplate, ghlSendWhatsAppTemplate } =
  createWhatsAppTemplatesClient({
    token: process.env.GHL_API_KEY,
    locationId: process.env.NEXT_PUBLIC_GHL_LOCATION_ID,
    assumeApproved: process.env.WHATSAPP_TEMPLATES_ASSUME_APPROVED,
  });
