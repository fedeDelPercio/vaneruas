// Backfill de los mensajes que escribió el EQUIPO desde GoHighLevel.
//
// Misma logica que el job de cada 5 minutos (src/lib/providers/ghl-human.ts),
// pero con service role y una ventana grande, para traer el historico de una.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GHL_API_KEY=... \
//   NEXT_PUBLIC_GHL_LOCATION_ID=... npx tsx scripts/import-mensajes-equipo.ts 90
import { createClient } from "@supabase/supabase-js";
import { importarMensajesDelEquipo } from "../src/lib/providers/ghl-human";

const dias = Number(process.argv[2] ?? 30);

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  console.log(`Importando los ultimos ${dias} dias...`);
  const r = await importarMensajesDelEquipo(sb, {
    sinceMs: Date.now() - dias * 86_400_000,
    maxConversaciones: 5000,
    clientSlug: process.env.NEXT_PUBLIC_CLIENT_SLUG ?? "vanesaruas",
  });
  console.log(r);
}
void main();
