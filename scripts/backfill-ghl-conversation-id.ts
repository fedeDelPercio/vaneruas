// Resuelve (READ-ONLY) el conversationId de GHL de las conversaciones de
// vanesaruas que todavía no lo tienen cacheado, y emite el SQL UPDATE para
// aplicar el backfill. No escribe en la DB: solo lee y resuelve vía GHL.
//
//   GHL_API_KEY=$(grep '^GHL_API_KEY=' .env.local | cut -d= -f2) \
//   NEXT_PUBLIC_GHL_LOCATION_ID=$(grep '^NEXT_PUBLIC_GHL_LOCATION_ID=' .env.local | cut -d= -f2) \
//   NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2) \
//   SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2) \
//     npx tsx scripts/backfill-ghl-conversation-id.ts
import { createClient } from "@supabase/supabase-js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";
const KEY = process.env.GHL_API_KEY;
const LOC = process.env.NEXT_PUBLIC_GHL_LOCATION_ID;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function resolveConvId(contactId: string): Promise<string | null> {
  const url = `${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(
    LOC!,
  )}&contactId=${encodeURIComponent(contactId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KEY}`, Version: GHL_VERSION, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    conversations?: { id: string; contactId?: string }[];
  };
  // Defensa extra: tomamos la conversación cuyo contactId coincide (si la API lo
  // devuelve); si no, la primera.
  const list = json.conversations ?? [];
  const exact = list.find((c) => c.contactId === contactId);
  return (exact ?? list[0])?.id ?? null;
}

async function main() {
  if (!KEY || !LOC || !SB_URL || !SB_KEY) {
    console.error("Faltan envs (GHL_API_KEY, NEXT_PUBLIC_GHL_LOCATION_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).");
    process.exit(1);
  }
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("conversations")
    .select("id, external_id, display_name")
    .eq("client_slug", "vanesaruas")
    .eq("source", "whatsapp")
    .not("external_id", "is", null)
    .is("ghl_conversation_id", null);
  if (error) {
    console.error("Error leyendo conversaciones:", error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  console.error(`Pendientes de backfill: ${rows.length}`);

  const pairs: [string, string][] = [];
  let nf = 0;
  for (const r of rows) {
    const convId = await resolveConvId(r.external_id as string);
    if (convId) {
      pairs.push([r.id, convId]);
      console.error(`  ok  ${r.display_name} -> ${convId}`);
    } else {
      nf++;
      console.error(`  --  ${r.display_name} (${r.external_id}) -> sin conversación`);
    }
  }

  console.error(`\nResueltas: ${pairs.length}, sin conversación: ${nf}`);
  if (!pairs.length) {
    console.error("Nada para actualizar.");
    return;
  }

  // SQL de backfill (lo aplica el operador por el canal auditado).
  const values = pairs.map(([id, conv]) => `('${id}'::uuid, '${conv}')`).join(",\n  ");
  console.log(
    `update conversations as c\n` +
      `set ghl_conversation_id = v.conv\n` +
      `from (values\n  ${values}\n) as v(id, conv)\n` +
      `where c.id = v.id and c.client_slug = 'vanesaruas' and c.ghl_conversation_id is null;`,
  );
}

void main();
