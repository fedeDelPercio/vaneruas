import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { RunContext } from "../types";

// ===========================================================================
// Tool: notify_team
//
// Schema en formato API directa de Anthropic (no MCP). El orquestador la
// declara entre `tools` al llamar a messages.create(); cuando el modelo
// emite un bloque tool_use con name === "notify_team", el orquestador
// invoca `applyNotifyTeam` para que actualice la señal del RunContext.
// Esa señal hace que run.ts "freezee" la conversación al terminar la
// iteración.
// ===========================================================================

export const NOTIFY_TEAM_TOOL_NAME = "notify_team";

export const NOTIFY_TEAM_TOOL_SCHEMA: Tool = {
  name: NOTIFY_TEAM_TOOL_NAME,
  description:
    "Notifica al equipo y entrega la conversación a un humano. Invocala " +
    "apenas se cumpla cualquiera de los disparadores definidos en tus " +
    "instrucciones. Después de llamarla, despedite con UN solo mensaje breve y " +
    "cordial que SIEMPRE le avise a la persona que pasás su consulta al equipo y " +
    "que le van a responder a la brevedad (no la dejes solo con una negativa) y " +
    "no respondas ninguna consulta más.",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description:
          "Categoría de la notificación en snake_case. Categorías válidas: " +
          "'fuera_de_conocimiento', 'escalado_manual', 'reclamo_certificado'. " +
          "Usá 'reclamo_certificado' cuando la persona reclama que no le llegó el " +
          "certificado o diploma de una masterclass a la que asistió. La intención " +
          "de compra NO deriva (la venta es autogestionada) y ser clienta tampoco " +
          "deriva. Usá las categorías definidas en el prompt del orquestador.",
      },
      reason: {
        type: "string",
        description: "Explicación breve del disparador detectado.",
      },
      summary: {
        type: "string",
        description:
          "Resumen para el equipo: qué necesita el cliente, qué le " +
          "respondiste hasta ahora y cualquier dato de contacto compartido.",
      },
    },
    required: ["category", "reason", "summary"],
  },
};

export interface NotifyTeamArgs {
  category: string;
  reason: string;
  summary: string;
}

/** Actualiza la señal en el RunContext para que run.ts derive la conversación. */
export function applyNotifyTeam(ctx: RunContext, args: NotifyTeamArgs): void {
  ctx.notification.notified = true;
  ctx.notification.category = args.category;
  ctx.notification.reason = args.reason;
  ctx.notification.summary = args.summary;
}
