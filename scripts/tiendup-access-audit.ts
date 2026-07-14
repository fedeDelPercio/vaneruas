// Auditoría READ-ONLY: cruza los inscriptos al curso en Tiendup contra los pagos
// de masterclass VALIDADOS del panel, por MAIL y por NOMBRE (el mail que
// capturamos por WhatsApp a veces viene mal: truncado, con basura, o la persona
// usa otro mail en Tiendup). No escribe nada; emite por stdout el SQL de backfill
// para marcar en el panel a quienes YA tienen acceso.
//
//   TIENDUP_API_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/tiendup-access-audit.ts
import { createClient } from "@supabase/supabase-js";

const TKEY = process.env.TIENDUP_API_KEY;
const THOST = process.env.TIENDUP_BASE_URL || "https://vanesaruas.public-api.tiendup.com";
const COURSE_ID = 519060;
const EVENT_SLUG = "masterclass-higiene-facial-dermaplaning";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface Enrolled { name: string | null; lastName: string | null; email: string | null }

/** minúsculas, sin acentos, solo alfanumérico (saca puntos, guiones, @, etc). */
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

async function listEnrolled(): Promise<Enrolled[]> {
  const out: Enrolled[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`${THOST}/learning/courses/${COURSE_ID}/enrolled?limit=100&page=${page}`, {
      headers: { "x-api-key": TKEY!, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`Tiendup ${r.status}`);
    const j = (await r.json()) as {
      data?: { name?: string; last_name?: string; email?: string }[];
      pages?: number;
    };
    const rows = j.data ?? [];
    out.push(
      ...rows.map((e) => ({
        name: e.name ?? null,
        lastName: e.last_name ?? null,
        email: e.email ?? null,
      })),
    );
    if (page >= Number(j.pages ?? 1) || !rows.length) break;
  }
  return out;
}

/** Match por mail (normalizado, tolera basura) o por NOMBRE (todos los tokens). */
function findMatch(enrolled: Enrolled[], email: string, fullName: string | null) {
  const em = norm(email);
  const byEmail = enrolled.find((e) => e.email && norm(e.email) === em);
  if (byEmail) return { by: "email" as const, e: byEmail };
  const tokens = (fullName ?? "").split(/\s+/).map(norm).filter((t) => t.length > 3);
  if (tokens.length >= 2) {
    const byName = enrolled.find((e) => {
      const full = norm(`${e.name ?? ""}${e.lastName ?? ""}`);
      return tokens.every((t) => full.includes(t));
    });
    if (byName) return { by: "nombre" as const, e: byName };
  }
  return null;
}

async function main() {
  if (!TKEY || !SB_URL || !SB_KEY) {
    console.error("Faltan TIENDUP_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const enrolled = await listEnrolled();
  console.error(`Inscriptos en Tiendup (curso ${COURSE_ID}): ${enrolled.length}\n`);

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data: convs } = await sb
    .from("conversations")
    .select("id, display_name, contact_email")
    .eq("client_slug", "vanesaruas");
  const convById = new Map((convs ?? []).map((c) => [c.id, c]));

  const { data: pays } = await sb
    .from("payment_validations")
    .select("id, conversation_id, course_access_granted_at")
    .eq("event_slug", EVENT_SLUG)
    .eq("status", "validated");

  const yaTienen: { payId: string; label: string }[] = [];
  const faltan: string[] = [];
  const sinMail: string[] = [];

  for (const p of pays ?? []) {
    const conv = p.conversation_id ? convById.get(p.conversation_id) : null;
    if (!conv) continue;
    const name = conv.display_name ?? "(sin nombre)";
    const email = (conv.contact_email ?? "").trim();
    if (!email) {
      sinMail.push(name);
      continue;
    }
    const m = findMatch(enrolled, email, conv.display_name);
    if (m) {
      yaTienen.push({
        payId: p.id,
        label: `${name} <${email}> → match por ${m.by}${m.by === "nombre" ? ` (en Tiendup: ${m.e.email})` : ""}`,
      });
    } else {
      faltan.push(`${name} <${email}>`);
    }
  }

  console.error(`=== Pagos de masterclass VALIDADOS: ${(pays ?? []).length} ===`);
  console.error(`  ✅ YA tienen acceso (mail o nombre): ${yaTienen.length}`);
  console.error(`  ❌ LES FALTA el acceso:              ${faltan.length}`);
  console.error(`  ⚠️  sin mail:                        ${sinMail.length}\n`);
  if (faltan.length) {
    console.error("--- LES FALTA EL ACCESO ---");
    for (const f of faltan) console.error(`  ${f}`);
    console.error();
  }

  // SQL de backfill: marcar a los que YA tienen acceso (no inscribe a nadie).
  if (yaTienen.length) {
    const ids = yaTienen.map((y) => `'${y.payId}'::uuid`).join(",\n    ");
    console.log(
      `-- Backfill: marca como "acceso ya dado" a ${yaTienen.length} pagos cuya persona\n` +
        `-- YA figura inscripta en Tiendup (match por mail o nombre). NO inscribe a nadie.\n` +
        `update payment_validations\n` +
        `set course_access_granted_at = now()\n` +
        `where id in (\n    ${ids}\n)\n  and course_access_granted_at is null;`,
    );
  }
}

void main();
