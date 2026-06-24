import "server-only";

// ===========================================================================
// Registry de tools del panel (formato API directa de Anthropic).
//
// El orquestador las pasa por `tools` en `messages.create()` y maneja el
// dispatch a mano cuando el modelo emite un bloque tool_use. No hay MCP
// server intermedio.
// ===========================================================================

export {
  NOTIFY_TEAM_TOOL_NAME,
  NOTIFY_TEAM_TOOL_SCHEMA,
  applyNotifyTeam,
  type NotifyTeamArgs,
} from "./notify_team";

export {
  REGISTRAR_NOMBRE_TOOL_NAME,
  REGISTRAR_NOMBRE_TOOL_SCHEMA,
  applyRegistrarNombre,
  type RegistrarNombreArgs,
} from "./registrar_nombre";

/** Nombres de tools que el agente puede invocar. */
export const PANEL_TOOL_NAMES = ["notify_team", "registrar_nombre"] as const;
export type PanelToolName = (typeof PANEL_TOOL_NAMES)[number];
