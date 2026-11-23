import { createWhatsAppTemplatesClient } from "../src/lib/providers/ghl-templates-client";

async function main() {
  const token = process.env.GHL_API_KEY;
  const locationId = process.env.NEXT_PUBLIC_GHL_LOCATION_ID;
  if (!token || !locationId) {
    console.error("Configurá GHL_API_KEY y NEXT_PUBLIC_GHL_LOCATION_ID");
    process.exitCode = 1;
    return;
  }

  const { listWhatsAppTemplates } = createWhatsAppTemplatesClient({
    token,
    locationId,
    assumeApproved: process.env.WHATSAPP_TEMPLATES_ASSUME_APPROVED,
  });
  const result = await listWhatsAppTemplates();
  if (!result.ok) {
    console.error("No se pudo listar las plantillas de WhatsApp en GHL");
    process.exitCode = 1;
    return;
  }
  console.table(result.templates.map(({ name, status, usable, body }) => ({
    name, status: status ?? "sin estado", usable, "body-length": body.length,
  })));
}

void main();
