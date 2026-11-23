import assert from "node:assert/strict";
import { createWhatsAppTemplatesClient } from "../src/lib/providers/ghl-templates-client";
import { approvalMessage, hasDeliveredEmailAsk, looksLikeEmailAsk } from "../src/lib/payments/email-ask";
import { PAYMENT_APPROVED_ASK_EMAIL_MESSAGE, PAYMENT_APPROVED_MESSAGE, TITLE_VALIDATED_PAYMENT_OK_MESSAGE } from "../src/lib/payments/messages";
import { TEXTOS_DE_PLANTILLA } from "../src/lib/providers/ghl-human";
import { TIENDUP_ACCESS_MESSAGE } from "../src/lib/tiendup/messages";
import { WHATSAPP_TEMPLATE_BODIES as bodies } from "../src/lib/whatsapp-template-bodies";
import { fixedTextVariants, persistWhatsAppDelivery, sendFixedWhatsApp, templateNameForContent, whatsappTemplatesEnabled, whatsappWindowOpen } from "../src/lib/whatsapp-templates";

const template = { id: "approved-id", name: "pago_verificado_mail", body: bodies.pago_verificado_mail, status: "APPROVED", usable: true };
const raw = (id: string, extra: object = {}) => ({
  id, name: id, type: "whatsapp", template: { body: "Texto" }, ...extra,
});

async function testCatalog() {
  const pageOne = [
    raw("approved", { approvalStatus: "approved" }),
    raw("active", { whatsappStatus: "Active - Quality Pending" }),
    raw("nested", { template: { body: "Texto", status: "Active - High" } }),
    raw("nested-approval", { template: { body: "Texto", approvalStatus: "APPROVED" } }),
    raw("review", { meta: { status: "In review" } }),
    raw("rejected", { status: "REJECTED" }),
    raw("unknown", { status: "UNKNOWN" }),
    raw("empty", { status: "" }),
    raw("null", { status: null }),
    raw("paused", { status: "PAUSED" }),
    raw("tiendup", { name: "altatiendup", status: "In review" }),
    raw("missing"), raw("assumed"),
    raw("pending-new", { name: "Pago", status: "PENDING", dateAdded: "2026-11-23" }),
    raw("approved-old", { name: "Pago", status: "APPROVED", dateAdded: "2026-11-01" }),
    raw("deleted", { name: "Pago", deletedAt: "2026-11-22", status: "APPROVED", dateAdded: "2026-11-22" }),
    raw("sms", { name: "Pago", type: "sms", status: "APPROVED", dateAdded: "2026-11-22" }),
  ];
  while (pageOne.length < 100) pageOne.push(raw(`other-${pageOne.length}`));

  const requests: string[] = [];
  let now = 0;
  let outage = false;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const version = new Headers(init?.headers).get("Version");
    if (init?.method === "POST") {
      assert.equal(version, "v3");
      assert.equal(url.pathname, "/conversations/messages");
      assert.deepEqual(JSON.parse(String(init.body)), { type: "WhatsApp", contactId: "contact", templateId: "approved-id" });
      return Response.json({ conversationId: "thread", messageId: "ghl-id" });
    }
    assert.equal(url.pathname, "/locations/loc/templates");
    assert.equal(url.searchParams.get("originId"), "loc");
    assert.equal(url.searchParams.get("type"), "whatsapp");
    assert.equal(url.searchParams.get("limit"), "100");
    const skip = url.searchParams.get("skip");
    requests.push(`${version}/${skip}`);
    if (outage) throw new Error("Sin conexión");
    if (version === "v3") return new Response(null, { status: 400 });
    return Response.json({
      templates: skip === "0" ? pageOne : [
        raw("approved-new", { name: "PAGO", status: "APPROVED", dateAdded: "2026-11-21" }),
      ],
      totalCount: 101,
    });
  };
  const client = createWhatsAppTemplatesClient({
    token: "dummy", locationId: "loc", assumeApproved: " ASSUMED , rejected, unknown, empty, null", fetch: request, now: () => now,
  });
  const [catalog, selected] = await Promise.all([client.listWhatsAppTemplates(), client.resolveTemplate("pago")]);
  assert.ok(catalog.ok);
  assert.equal(selected?.id, "approved-new");
  assert.equal(await client.resolveTemplate("pag"), null);
  assert.equal(await client.resolveTemplate("Pago "), null);
  assert.deepEqual(requests, ["v3/0", "2021-07-28/0", "2021-07-28/100"]);
  for (const id of ["approved", "active", "nested", "nested-approval", "assumed"]) {
    assert.equal((await client.resolveTemplate(id))?.usable, true, id);
  }
  for (const id of ["review", "rejected", "unknown", "empty", "null", "paused", "missing"]) {
    assert.equal((await client.resolveTemplate(id))?.usable, false, id);
  }
  assert.equal((await client.resolveTemplate("assumed"))?.status, null);
  assert.equal(await client.ghlSendWhatsAppTemplate("contact", template.id), "ghl-id");

  assert.equal((await client.resolveTemplate("altatiendup"))?.usable, false);
  const index = pageOne.findIndex(({ id }) => id === "tiendup");
  pageOne[index] = raw("tiendup", { name: "altatiendup", status: "APPROVED" });
  outage = true;
  now = 599_999;
  assert.equal((await client.listWhatsAppTemplates()).ok, true);
  now++;
  assert.deepEqual(await client.listWhatsAppTemplates(), { ok: false });
  assert.equal(requests.length, 4);
  now += 59_999;
  assert.deepEqual(await client.listWhatsAppTemplates(), { ok: false });
  assert.equal(requests.length, 4);
  now++;
  outage = false;
  assert.equal((await client.listWhatsAppTemplates()).ok, true);
  assert.equal(requests.length, 7);
  assert.equal((await client.resolveTemplate("altatiendup"))?.usable, true);
}

async function testDelivery() {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const cutoff = now - (24 * 60 - 10) * 60_000;
  assert.equal(whatsappWindowOpen(new Date(cutoff + 1).toISOString(), now), true);
  assert.equal(whatsappWindowOpen(new Date(cutoff).toISOString(), now), false);
  assert.equal(whatsappWindowOpen(new Date(cutoff - 1).toISOString(), now), false);
  assert.equal(whatsappWindowOpen(null, now), false);
  assert.equal(whatsappWindowOpen("fecha inválida", now), false);

  const trace: string[] = [];
  const options = {
    templateName: template.name,
    windowOpen: false,
    sendText: async () => { trace.push("texto"); return "texto-id"; },
    resolveTemplate: async () => { trace.push("listado"); return { template, listed: true }; },
    sendTemplate: async (id: string) => { trace.push(id); return "ghl-id"; },
  };
  const off = whatsappTemplatesEnabled("false") ? options.templateName : null;
  assert.deepEqual(await sendFixedWhatsApp({ ...options, templateName: off }), { messageId: "texto-id" });
  assert.deepEqual(trace.splice(0), ["texto"]);
  assert.deepEqual(await sendFixedWhatsApp({ ...options, windowOpen: true }), { messageId: "texto-id" });
  assert.deepEqual(trace.splice(0), ["texto"]);
  const sent = await sendFixedWhatsApp(options);
  assert.deepEqual(sent, { messageId: "ghl-id", template, trigger: "ventana de 24 h cerrada" });
  assert.deepEqual(trace.splice(0), ["listado", template.id]);

  const sendText = async () => { trace.push("texto"); throw new Error("GHL 400: 131047"); };
  const unavailable = async () => { trace.push("listado"); return { template: { ...template, usable: false }, listed: true }; };
  await assert.rejects(sendFixedWhatsApp({ ...options, sendText, resolveTemplate: unavailable }), /plantilla pago_verificado_mail no aprobada/);
  assert.deepEqual(trace.splice(0), ["listado", "texto"]);
  await assert.rejects(sendFixedWhatsApp({
    ...options, sendText, resolveTemplate: async () => ({ template: null, listed: false }),
  }), /no se pudo consultar/);
  assert.deepEqual(trace.splice(0), ["texto"]);
  assert.deepEqual(await sendFixedWhatsApp({ ...options, resolveTemplate: unavailable }), { messageId: "texto-id" });
  assert.deepEqual(trace.splice(0), ["listado", "texto"]);
  const fallback = await sendFixedWhatsApp({ ...options, windowOpen: true, sendText });
  assert.equal(fallback.template?.id, template.id);
  assert.deepEqual(trace.splice(0), ["texto", "listado", template.id]);
  await assert.rejects(sendFixedWhatsApp({
    ...options, windowOpen: true,
    sendText: async () => { throw new Error("GHL 403: permiso denegado"); },
  }), /permiso denegado/);
  assert.deepEqual(trace, []);

  for (const [result, reason] of [[sent, "ventana de 24 h cerrada"], [fallback, "fallback por error de ventana"]] as const) {
    const history: { id?: string | null; content: string; note?: string } = {
      content: PAYMENT_APPROVED_ASK_EMAIL_MESSAGE,
    };
    await persistWhatsAppDelivery(result, {
      markDelivered: async (id, content) => { history.id = id; history.content = content ?? history.content; },
      addSystemNote: async (note) => { history.note = note; },
    });
    assert.deepEqual(history, {
      id: "ghl-id", content: bodies.pago_verificado_mail,
      note: `Enviado con plantilla de WhatsApp pago_verificado_mail (${reason})`,
    });
  }
}

function testMappingAndDedup() {
  for (const value of ["1", "true", "on"]) assert.equal(whatsappTemplatesEnabled(value), true);
  for (const value of ["", "0", "false", "yes"]) assert.equal(whatsappTemplatesEnabled(value), false);
  assert.equal(templateNameForContent(PAYMENT_APPROVED_ASK_EMAIL_MESSAGE, ""), "pago_verificado_mail");
  assert.equal(templateNameForContent(TIENDUP_ACCESS_MESSAGE, "{"), "altatiendup");
  assert.equal(templateNameForContent(PAYMENT_APPROVED_MESSAGE, '{"PAYMENT_APPROVED_MESSAGE":"otra"}'), "otra");
  assert.equal(templateNameForContent("Texto libre", ""), null);

  assert.equal(looksLikeEmailAsk(bodies.pago_verificado_mail), true);
  const delivered = { content: bodies.pago_verificado_mail, external_id: "ghl-id", delivered_at: null };
  const alreadyAsked = hasDeliveredEmailAsk([delivered], "whatsapp");
  assert.equal(alreadyAsked, true);
  assert.equal(approvalMessage({ hasEmail: false, alreadyAsked }).asksEmail, false);
  assert.equal(hasDeliveredEmailAsk([{ ...delivered, external_id: null }], "whatsapp"), false);
  assert.equal(fixedTextVariants(TIENDUP_ACCESS_MESSAGE).includes(bodies.altatiendup), true);
  assert.equal(fixedTextVariants(TITLE_VALIDATED_PAYMENT_OK_MESSAGE).includes(bodies.pago_verificado), true);
  for (const body of Object.values(bodies)) assert.ok(TEXTOS_DE_PLANTILLA.includes(body));
}

async function main() {
  await testCatalog();
  await testDelivery();
  testMappingAndDedup();
  console.log("Plantillas de WhatsApp: catálogo, caché, entrega, historial y deduplicación OK");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
