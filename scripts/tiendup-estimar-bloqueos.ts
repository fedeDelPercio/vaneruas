// Estimación SOLO LECTURA: cuántos casos pendientes de acceso quedarían
// frenados por la regla "el alta automática no crea clientes nuevos en
// Tiendup" (D-68). No escribe nada ni en Supabase ni en Tiendup: solo SELECT y
// GET (/customers y /learning/courses/{id}/enrolled).
//
// Universo: comprobantes de masterclass VALIDADOS, sin acceso marcado, del
// evento con acceso vigente, cuya conversación tiene correo. Se agrupa por
// persona + curso (quien pagó en dos transferencias cuenta una vez) y se
// clasifica con la MISMA decisión que el alta automática (decideGrantAction,
// modo "auto").
//
// Salida: solo conteos y correos ENMASCARADOS (ma***@gm***.com). Nunca
// imprime correos completos, nombres ni ids de conversación.
//
//   TIENDUP_API_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/tiendup-estimar-bloqueos.ts
import { createClient } from "@supabase/supabase-js";
import { normalizeContactEmail } from "../src/lib/contact-email";
import { accesoVigenteDeEvento, eventBySlug } from "../src/lib/payments/event-match";
import { fetchAllCustomers } from "../src/lib/tiendup/customers";
import { decideGrantAction } from "../src/lib/tiendup/customer-gate";
import { fixDominioDeCorreo, type TiendupEnrolled } from "../src/lib/tiendup/match";
import { maskEmail } from "../src/lib/tiendup/status";

const TKEY = process.env.TIENDUP_API_KEY;
const THOST = (process.env.TIENDUP_BASE_URL || "https://vanesaruas.public-api.tiendup.com").replace(/\/+$/, "");
const SLUG = process.env.CLIENT_SLUG ?? "vanesaruas";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Mismo mapeo que src/lib/tiendup/client.ts (TIENDUP_COURSE_BY_EVENT_SLUG).
const COURSE_BY_EVENT: Record<string, number> = {
  "masterclass-higiene-facial-dermaplaning": 519060,
  "masterclass-peelings-verano": 554178,
};

/** Mismo criterio que listEnrolledChecked (client.ts), solo GET. */
async function listEnrolledChecked(courseId: number): Promise<{ enrolled: TiendupEnrolled[]; complete: boolean }> {
  const out: TiendupEnrolled[] = [];
  try {
    for (let page = 1; page <= 50; page++) {
      const r = await fetch(`${THOST}/learning/courses/${courseId}/enrolled?limit=100&page=${page}`, {
        headers: { "x-api-key": TKEY!, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) return { enrolled: out, complete: false };
      const j = (await r.json()) as {
        data?: { name?: string; last_name?: string; email?: string }[];
        pages?: number | string;
      };
      const rows = j.data ?? [];
      for (const e of rows) out.push({ name: e.name ?? null, lastName: e.last_name ?? null, email: e.email ?? null });
      if (page >= Number(j.pages ?? 1) || !rows.length) return { enrolled: out, complete: true };
    }
  } catch {
    // cae a incompleto
  }
  return { enrolled: out, complete: false };
}

type Bucket =
  | "ya_inscripta"
  | "otro_correo"
  | "cliente_se_inscribiria"
  | "BLOQUEADA_no_figura"
  | "BLOQUEADA_sin_verificar";

async function main() {
  if (!TKEY || !SB_URL || !SB_KEY) {
    console.error("Faltan TIENDUP_API_KEY, NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const { data: pays, error } = await sb
    .from("payment_validations")
    .select("id, conversation_id, event_slug, awaiting_title")
    .eq("client_slug", SLUG)
    .eq("status", "validated")
    .is("course_access_granted_at", null);
  if (error) throw new Error(error.message);

  const pending = (pays ?? []).filter((p) => {
    const ev = eventBySlug(p.event_slug);
    return Boolean(ev) && ev!.slug !== "congreso" && accesoVigenteDeEvento(p.event_slug);
  });
  const convIds = [...new Set(pending.map((p) => p.conversation_id).filter(Boolean))] as string[];

  const emails = new Map<string, { email: string | null; name: string | null }>();
  for (let i = 0; i < convIds.length; i += 200) {
    const { data, error: e } = await sb
      .from("conversations")
      .select("id, contact_email, display_name")
      .eq("client_slug", SLUG)
      .in("id", convIds.slice(i, i + 200));
    if (e) throw new Error(e.message);
    for (const c of data ?? []) emails.set(c.id, { email: c.contact_email, name: c.display_name });
  }

  // Persona + curso (dedup de comprobantes múltiples).
  const cases = new Map<string, { courseId: number; email: string; name: string | null; awaitingTitle: boolean }>();
  let sinCorreo = 0;
  let correoInvalido = 0;
  let sinCurso = 0;
  for (const p of pending) {
    const courseId = COURSE_BY_EVENT[p.event_slug ?? ""];
    if (!courseId) {
      sinCurso++;
      continue;
    }
    const conv = p.conversation_id ? emails.get(p.conversation_id) : undefined;
    const raw = conv?.email?.trim();
    if (!raw) {
      sinCorreo++;
      continue;
    }
    const valid = normalizeContactEmail(raw);
    if (!valid) {
      correoInvalido++;
      continue;
    }
    const email = fixDominioDeCorreo(valid).email;
    const key = `${p.conversation_id}|${courseId}`;
    const prev = cases.get(key);
    cases.set(key, {
      courseId,
      email,
      name: conv?.name ?? null,
      // Si alguno de sus comprobantes no está retenido, el alta automática lo intentaría.
      awaitingTitle: prev ? prev.awaitingTitle && p.awaiting_title : p.awaiting_title,
    });
  }

  console.log(`Comprobantes pendientes de acceso (evento vigente): ${pending.length}`);
  console.log(`  sin correo: ${sinCorreo} · correo inválido: ${correoInvalido} · sin curso mapeado: ${sinCurso}`);
  console.log(`  casos persona+curso con correo: ${cases.size}`);

  console.log("\nLeyendo clientes de Tiendup (GET /customers)…");
  const customers = await fetchAllCustomers({ apiKey: TKEY, baseUrl: THOST });
  console.log(`  clientes: ${customers.customers.length} · ok: ${customers.ok} · completo: ${customers.complete}`);

  const enrolledByCourse = new Map<number, { enrolled: TiendupEnrolled[]; complete: boolean }>();
  for (const courseId of new Set([...cases.values()].map((c) => c.courseId))) {
    const l = await listEnrolledChecked(courseId);
    enrolledByCourse.set(courseId, l);
    console.log(`  curso ${courseId}: ${l.enrolled.length} inscriptos · completo: ${l.complete}`);
  }

  const counts: Record<Bucket, number> = {
    ya_inscripta: 0,
    otro_correo: 0,
    cliente_se_inscribiria: 0,
    BLOQUEADA_no_figura: 0,
    BLOQUEADA_sin_verificar: 0,
  };
  let retenidasPorTitulo = 0;
  const bloqueadas: string[] = [];
  for (const c of cases.values()) {
    const enrolled = enrolledByCourse.get(c.courseId)!;
    let bucket: Bucket;
    if (!enrolled.complete) {
      bucket = "BLOQUEADA_sin_verificar";
    } else {
      const d = await decideGrantAction({
        mode: "auto",
        enrolled: enrolled.enrolled,
        email: c.email,
        fullName: c.name,
        loadCustomers: async () => customers,
      });
      bucket =
        d.action === "already_enrolled"
          ? "ya_inscripta"
          : d.action === "name_conflict"
            ? "otro_correo"
            : d.action === "enroll"
              ? "cliente_se_inscribiria"
              : d.action === "block" && d.reason === "not_in_tiendup"
                ? "BLOQUEADA_no_figura"
                : "BLOQUEADA_sin_verificar";
    }
    counts[bucket]++;
    if (c.awaitingTitle) retenidasPorTitulo++;
    if (bucket === "BLOQUEADA_no_figura") bloqueadas.push(`${maskEmail(c.email)} (curso ${c.courseId})`);
  }

  console.log("\nClasificación (misma decisión que el alta automática):");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(26)} ${v}`);
  console.log(`  (de esos casos, retenidos por título hoy: ${retenidasPorTitulo})`);
  if (bloqueadas.length) {
    console.log("\nCorreos que quedarían frenados por no figurar (enmascarados):");
    for (const b of bloqueadas) console.log(`  ${b}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
