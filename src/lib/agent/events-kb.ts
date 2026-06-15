import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  cardPriceLabel,
  internationalPriceLabel,
  kindLabel,
  transferPriceLabel,
} from "@/lib/events/format";

// ===========================================================================
// Catálogo de eventos en vivo para el agente.
//
// Los eventos (masterclass / congreso) viven en la tabla `events`, editable
// desde el panel. Acá los leemos y armamos un bloque de markdown que se
// inyecta en la base de conocimiento del orquestador en tiempo de request,
// junto al `knowledge-base.md` estático. Así el cliente carga una masterclass
// nueva desde la UI y el agente la comunica sin tocar prompts ni reiniciar.
//
// Solo entran los eventos que el agente PUEDE comunicar: status 'activo' y con
// fecha de lanzamiento (announce_at) ya cumplida (o nula). Borrador y
// archivado quedan afuera.
// ===========================================================================

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
}

interface EventRow {
  title: string;
  kind: string;
  event_at: string | null;
  event_end_at: string | null;
  card_total: number | null;
  card_installments: number | null;
  transfer_price: number | null;
  international_price: number | null;
  details: string | null;
  landing_url: string | null;
}

function renderEvent(e: EventRow): string {
  const lines: string[] = [`## ${e.title} (${kindLabel(e.kind)})`];

  const when = fmtDate(e.event_at);
  const end = fmtDate(e.event_end_at);
  if (when) {
    lines.push(`- **Fecha del evento:** ${end ? `del ${when} al ${end}` : when}`);
  }

  const card = cardPriceLabel(e.card_total, e.card_installments);
  const transfer = transferPriceLabel(e.transfer_price);
  const intl = internationalPriceLabel(e.international_price);
  if (card || transfer || intl) {
    lines.push("- **Precios:**");
    if (transfer) lines.push(`  - Transferencia: ${transfer}`);
    if (card) lines.push(`  - Con tarjeta: ${card}`);
    if (intl) lines.push(`  - Pagos internacionales: ${intl}`);
  }

  if (e.landing_url && e.landing_url.trim()) {
    lines.push(
      `- **Link de la web:** ${e.landing_url.trim()} (podés compartirlo si quiere ver más detalle)`,
    );
  }

  if (e.details && e.details.trim()) {
    lines.push("", e.details.trim());
  }

  return lines.join("\n");
}

/**
 * Devuelve el bloque de markdown con los eventos vigentes, listo para
 * concatenar a la base de conocimiento. Si no hay eventos comunicables,
 * devuelve "" (el caller lo filtra y no agrega nada al prompt).
 *
 * Nunca lanza: si la query falla, loguea y devuelve "" para no tumbar al
 * agente por un problema de catálogo.
 */
export async function loadActiveEventsBlock(): Promise<string> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await getSupabaseServerClient()
      .from("events")
      .select(
        "title, kind, event_at, event_end_at, card_total, card_installments, transfer_price, international_price, details, landing_url, announce_at",
      )
      .eq("status", "activo")
      .or(`announce_at.is.null,announce_at.lte.${nowIso}`)
      .order("event_at", { ascending: true });

    if (error) {
      console.error("[events-kb] no se pudieron cargar los eventos:", error.message);
      return "";
    }
    if (!data?.length) return "";

    const blocks = data.map((e) => renderEvent(e as EventRow));
    return [
      "# EVENTOS VIGENTES",
      "",
      "Estos son los eventos que podés comunicar ahora mismo, con sus precios y " +
        "fechas actualizadas. Tienen prioridad sobre cualquier dato de evento más " +
        "abajo en la base de conocimiento. Si un evento no figura acá, no lo " +
        "ofrezcas todavía.",
      "",
      blocks.join("\n\n"),
    ].join("\n");
  } catch (err) {
    console.error("[events-kb] error inesperado cargando eventos:", err);
    return "";
  }
}
