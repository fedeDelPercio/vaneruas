import "server-only";

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ghlUpdateContact } from "@/lib/providers/ghl";
import type { RunContext } from "../types";

// ===========================================================================
// Tool: registrar_nombre
//
// El agente la invoca cuando la persona le da su nombre y apellido (para
// agendarla). NO es una derivación: solo registra el dato. Efecto:
//  - actualiza el display_name de la conversación (lo ve el panel / módulo
//    Agendar),
//  - setea firstName/lastName en el contacto de GHL (best-effort; requiere el
//    scope contacts.write en el PIT).
// Así el alta en GHL queda hecha sola y al equipo solo le queda, según el caso,
// sumarla a los grupos de WhatsApp.
// ===========================================================================

export const REGISTRAR_NOMBRE_TOOL_NAME = "registrar_nombre";

export const REGISTRAR_NOMBRE_TOOL_SCHEMA: Tool = {
  name: REGISTRAR_NOMBRE_TOOL_NAME,
  description:
    "Registrá el nombre y apellido de la persona cuando te lo dé, para agendarla " +
    "en nuestra base. Invocala UNA sola vez, apenas la persona te comparta su " +
    "nombre y apellido (no la llames si ya lo hiciste antes en la conversación, ni " +
    "si solo te dio el nombre de pila sin apellido). Esto NO deriva la conversación: " +
    "seguís atendiéndola normalmente. Cuando la llames, además respondé con un " +
    "mensaje cálido y natural (ej. confirmando que la agendás), no la dejes sin " +
    "respuesta.",
  input_schema: {
    type: "object",
    properties: {
      first_name: {
        type: "string",
        description: "Nombre de pila de la persona, tal como lo escribió.",
      },
      last_name: {
        type: "string",
        description: "Apellido de la persona, tal como lo escribió.",
      },
    },
    required: ["first_name", "last_name"],
  },
};

export interface RegistrarNombreArgs {
  first_name: string;
  last_name: string;
}

/**
 * Aplica el registro del nombre: actualiza el display_name de la conversación y
 * setea el nombre en el contacto de GHL (best-effort). No lanza: cualquier error
 * se loguea y la corrida del agente sigue normal.
 */
export async function applyRegistrarNombre(
  ctx: RunContext,
  args: RegistrarNombreArgs,
): Promise<void> {
  const first = args.first_name?.trim() || "";
  const last = args.last_name?.trim() || "";
  const fullName = [first, last].filter(Boolean).join(" ");
  if (!fullName) return;

  try {
    const sb = getSupabaseServerClient();
    const { data: conv } = await sb
      .from("conversations")
      .select("source, external_id, display_name")
      .eq("id", ctx.conversationId)
      .maybeSingle();

    // Actualizar el nombre que mostramos (panel / módulo Agendar) si cambió.
    if (fullName !== (conv?.display_name ?? "")) {
      await sb
        .from("conversations")
        .update({ display_name: fullName })
        .eq("id", ctx.conversationId);
    }

    // Setear el nombre en GHL (best-effort).
    if (conv?.source === "whatsapp" && conv.external_id) {
      await ghlUpdateContact(conv.external_id, { firstName: first, lastName: last });
    }
  } catch (err) {
    console.error("[registrar_nombre] no se pudo registrar el nombre:", err);
  }
}
