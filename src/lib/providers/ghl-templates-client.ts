const GHL_BASE = "https://services.leadconnectorhq.com";
const PAGE_SIZE = 100;

export interface WhatsAppTemplate {
  id: string;
  name: string;
  body: string;
  status: string | null;
  usable: boolean;
}

type ListResult =
  | { ok: true; templates: WhatsAppTemplate[] }
  | { ok: false };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function createWhatsAppTemplatesClient(opts: {
  token?: string;
  locationId?: string;
  assumeApproved?: string;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const request = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const assumed = new Set(opts.assumeApproved?.split(",").map(normalized));
  let cache: { result: ListResult; expiresAt: number } | undefined;
  let pending: Promise<ListResult> | undefined;

  async function list(): Promise<ListResult> {
    if (!opts.token || !opts.locationId) return { ok: false };
    const templates: { template: WhatsAppTemplate; date: number }[] = [];
    const seen = new Set<string>();
    let version = "v3";
    for (let skip = 0; ; ) {
      const url = new URL(`${GHL_BASE}/locations/${encodeURIComponent(opts.locationId)}/templates`);
      url.search = new URLSearchParams({
        originId: opts.locationId, type: "whatsapp", limit: String(PAGE_SIZE), skip: String(skip),
      }).toString();
      const get = () => request(url, {
        headers: { Authorization: `Bearer ${opts.token}`, Version: version, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      let res = await get();
      if (skip === 0 && [400, 404, 422].includes(res.status)) {
        version = "2021-07-28";
        res = await get();
      }
      if (!res.ok) return { ok: false };
      const page = record(await res.json());
      if (!Array.isArray(page.templates)) return { ok: false };
      if (!page.templates.length) {
        if (typeof page.totalCount === "number" && skip < page.totalCount) return { ok: false };
        break;
      }
      let newIds = 0;
      for (const raw of page.templates) {
        const t = record(raw);
        if (typeof t.id !== "string" || seen.has(t.id)) continue;
        seen.add(t.id);
        newIds++;
        if (typeof t.name !== "string" || normalized(t.type) !== "whatsapp") continue;
        if ([t.deleted, t.isDeleted].some((value) => value === true || normalized(value) === "true") || t.deletedAt || t.dateDeleted) continue;
        const payload = record(t.template);
        const statuses = [t.status, t.approvalStatus, t.whatsappStatus, payload.status, record(t.meta).status, payload.approvalStatus];
        const reported = statuses.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
        if (reported.some((value) => normalized(value) === "deleted")) continue;
        const approved = (value: string) => {
          const status = normalized(value);
          return status === "approved" || status.startsWith("active");
        };
        // Ante estados contradictorios, prevalece el que impide el envío.
        const status = reported.find((value) => !approved(value)) ?? reported[0] ?? null;
        const body = typeof payload.body === "string" ? payload.body : "";
        const usable = Boolean(body.trim()) && (status
          ? reported.every(approved)
          : statuses.every((value) => value === undefined) && assumed.has(normalized(t.name)));
        templates.push({
          template: { id: t.id, name: t.name, body, status, usable },
          date: Date.parse(String(t.dateAdded ?? "")) || 0,
        });
      }
      // Si el servidor ignora skip, evitamos un bucle y descartamos el listado parcial.
      if (!newIds) return { ok: false };
      skip += page.templates.length;
      if (typeof page.totalCount === "number" ? skip >= page.totalCount : page.templates.length < PAGE_SIZE) break;
    }
    templates.sort((a, b) => Number(b.template.usable) - Number(a.template.usable) || b.date - a.date);
    return { ok: true, templates: templates.map(({ template }) => template) };
  }

  function listWhatsAppTemplates(): Promise<ListResult> {
    if (cache && now() < cache.expiresAt) return Promise.resolve(cache.result);
    pending ??= list().catch((): ListResult => ({ ok: false })).then((result) => {
      cache = { result, expiresAt: now() + (result.ok ? 600_000 : 60_000) };
      pending = undefined;
      return result;
    });
    return pending;
  }

  async function resolveTemplate(name: string, catalog?: ListResult) {
    const result = catalog ?? await listWhatsAppTemplates();
    if (!result.ok) return null;
    return result.templates.find((template) => template.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  async function ghlSendWhatsAppTemplate(contactId: string, templateId: string): Promise<string> {
    if (!opts.token) throw new Error("GHL_API_KEY no configurada");
    const res = await request(`${GHL_BASE}/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`, Version: "v3",
        "Content-Type": "application/json", Accept: "application/json",
      },
      body: JSON.stringify({ type: "WhatsApp", contactId, templateId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GHL send template ${res.status}: ${body.slice(0, 300)}`);
    }
    const { messageId } = record(await res.json());
    if (typeof messageId !== "string" || !messageId.trim()) {
      throw new Error("GHL no devolvió el id del envío de plantilla");
    }
    return messageId;
  }

  return { listWhatsAppTemplates, resolveTemplate, ghlSendWhatsAppTemplate };
}
