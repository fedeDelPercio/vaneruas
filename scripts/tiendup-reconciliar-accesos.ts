// Reconcilia el panel con la realidad de Tiendup: marca como "acceso dado" los
// comprobantes validados cuya persona YA figura inscripta en el curso.
//
// Por que hace falta: el equipo viene dando las altas a mano desde Tiendup, no
// desde Aprobaciones. El panel no se entera, asi que la pestaña "Falta acceso"
// muestra decenas de casos ya resueltos y esconde los pocos que faltan de
// verdad.
//
// El cruce es por MAIL y por NOMBRE, igual que el chequeo previo de
// src/lib/tiendup/client.ts: el mail que capturamos por WhatsApp viene mal
// seguido (typos de dominio, truncado, o la persona usa otro mail en Tiendup),
// asi que mirar solo el mail deja afuera a muchas que si tienen acceso.
//
// Por defecto NO escribe. Para aplicar: --apply
//
//   TIENDUP_API_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/tiendup-reconciliar-accesos.ts [--apply]
import { createClient } from "@supabase/supabase-js";

const TKEY = process.env.TIENDUP_API_KEY!;
const THOST = process.env.TIENDUP_BASE_URL || "https://vanesaruas.public-api.tiendup.com";
const SLUG = process.env.CLIENT_SLUG ?? "vanesaruas";
const APPLY = process.argv.includes("--apply");

// Mismo mapeo que src/lib/tiendup/client.ts.
const CURSOS: { eventSlug: string; courseId: number; nombre: string }[] = [
  { eventSlug: "masterclass-higiene-facial-dermaplaning", courseId: 519060, nombre: "Higiene Facial + Dermaplaning" },
  { eventSlug: "masterclass-peelings-verano", courseId: 554178, nombre: "Peelings de Verano" },
];

// Typos de dominio que corregimos antes de comparar (ver fixDominioDeCorreo).
const TYPOS: Record<string, string> = {
  "gmail.con": "gmail.com",
  "gmail.cmo": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.co": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "hotmail.con": "hotmail.com",
  "hotmail.cmo": "hotmail.com",
  "hotmail.om": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "outlook.con": "outlook.com",
  "yahoo.con": "yahoo.com",
  "icloud.con": "icloud.com",
};

function arreglarDominio(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  const dom = email.slice(at + 1).toLowerCase();
  return TYPOS[dom] ? `${email.slice(0, at)}@${TYPOS[dom]}` : email;
}

/** minusculas, sin acentos, solo alfanumerico (saca puntos, guiones, arroba). */
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

interface Inscripto {
  name: string | null;
  lastName: string | null;
  email: string | null;
}

async function listarInscriptos(courseId: number): Promise<Inscripto[]> {
  const out: Inscripto[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(
      `${THOST}/learning/courses/${courseId}/enrolled?limit=100&page=${page}`,
      { headers: { "x-api-key": TKEY, Accept: "application/json" } },
    );
    if (!r.ok) throw new Error(`Tiendup ${r.status} en el curso ${courseId}`);
    const j = (await r.json()) as {
      data?: { name?: string; last_name?: string; email?: string }[];
      pages?: number;
    };
    const rows = j.data ?? [];
    for (const e of rows) {
      out.push({ name: e.name ?? null, lastName: e.last_name ?? null, email: e.email ?? null });
    }
    if (page >= Number(j.pages ?? 1) || rows.length === 0) break;
  }
  return out;
}

async function main() {
  if (!TKEY) throw new Error("Falta TIENDUP_API_KEY");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(APPLY ? "MODO APLICAR (escribe en la base)\n" : "MODO PRUEBA (no escribe nada)\n");

  let totalMarcados = 0;
  const faltantes: string[] = [];

  for (const curso of CURSOS) {
    const inscriptos = await listarInscriptos(curso.courseId);
    const mails = new Set(inscriptos.map((e) => norm(e.email)).filter(Boolean));
    const nombres = inscriptos.map((e) => norm(`${e.name ?? ""}${e.lastName ?? ""}`));

    const { data: pagos } = await sb
      .from("payment_validations")
      .select("id, sender_name, contact_name, conversation_id, amount, created_at")
      .eq("client_slug", SLUG)
      .eq("event_slug", curso.eventSlug)
      .eq("status", "validated")
      .is("course_access_granted_at", null);

    const pendientes = pagos ?? [];
    console.log(`=== ${curso.nombre}`);
    console.log(`    inscriptos en Tiendup: ${inscriptos.length}`);
    console.log(`    validados sin acceso marcado en el panel: ${pendientes.length}`);

    const aMarcar: string[] = [];
    for (const p of pendientes) {
      const { data: conv } = p.conversation_id
        ? await sb
            .from("conversations")
            .select("contact_email, display_name")
            .eq("id", p.conversation_id)
            .maybeSingle()
        : { data: null };
      const mailCrudo = (conv as { contact_email?: string | null } | null)?.contact_email?.trim();
      const mail = mailCrudo ? arreglarDominio(mailCrudo) : null;
      const nombre =
        (conv as { display_name?: string | null } | null)?.display_name ??
        p.contact_name ??
        p.sender_name ??
        "";

      const porMail = mail ? mails.has(norm(mail)) : false;
      const tokens = String(nombre)
        .split(/\s+/)
        .map(norm)
        .filter((t) => t.length > 3);
      // Match por nombre SOLO si es inequivoco: si dos inscriptas distintas
      // responden al mismo nombre (pasa con los nombres comunes), no se puede
      // saber cual es y marcarla como "ya tiene acceso" seria mentir.
      const coincidencias =
        tokens.length >= 2 ? nombres.filter((n) => tokens.every((t) => n.includes(t))).length : 0;
      const porNombre = coincidencias === 1;
      const ambiguo = coincidencias > 1;

      if (porMail || porNombre) {
        aMarcar.push(p.id);
        console.log(`    ok   ${nombre} · ${mail ?? "sin mail"} · match por ${porMail ? "mail" : "nombre"}`);
      } else {
        faltantes.push(
          `${curso.nombre} · ${nombre} · ${mail ?? "SIN MAIL"} · ${p.created_at.slice(0, 10)}` +
            (ambiguo ? `  (ojo: ${coincidencias} inscriptas con ese nombre)` : ""),
        );
      }
    }

    if (APPLY && aMarcar.length) {
      // De a tandas, para no armar un IN gigante.
      for (let i = 0; i < aMarcar.length; i += 100) {
        const { error } = await sb
          .from("payment_validations")
          .update({
            course_access_granted_at: new Date().toISOString(),
            course_access_error: null,
            updated_at: new Date().toISOString(),
          })
          .in("id", aMarcar.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }
    }
    totalMarcados += aMarcar.length;
    console.log(`    ${APPLY ? "marcados" : "se marcarian"}: ${aMarcar.length}\n`);
  }

  console.log(`TOTAL ${APPLY ? "marcados" : "a marcar"}: ${totalMarcados}`);
  console.log(`\nSIGUEN SIN ACCESO (${faltantes.length}), hay que darselo a mano:`);
  for (const f of faltantes) console.log(`  ${f}`);
  if (!APPLY) console.log(`\nPara aplicarlo: agregar --apply`);
}

void main();
