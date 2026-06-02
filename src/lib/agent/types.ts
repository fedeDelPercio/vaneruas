// Tipos compartidos del sistema agentico.

import type {
  TraceStatus,
  Provider,
  NotificationCategory,
} from "@/lib/supabase/types";

/** Un mensaje del historial de conversacion que recibe el agente. */
export interface HistoryMessage {
  role: "user" | "assistant" | "human" | "system";
  content: string;
}

/** Input del entry point runAgent(). */
export interface AgentRunInput {
  conversationId: string;
  userMessageId: string;
  userMessage: string;
  /** Historial previo (el panel manda los ultimos ~20 mensajes). */
  history: HistoryMessage[];
}

/**
 * Resultado de runAgent(). `assistantMessage` SIEMPRE trae un texto visible
 * para el usuario: la respuesta real si fue 'completed', o un aviso si fue
 * 'escalated'/'failed'. Asi el panel muestra siempre una burbuja con su trace.
 */
export interface AgentRunResult {
  traceId: string;
  assistantMessage: string;
  status: "completed" | "escalated" | "failed";
  escalationReason?: string;
  /**
   * Solo en status 'escalated'. `true` si esta derivacion registró una
   * notificación NUEVA al equipo; `false` si la conversación ya tenía una
   * notificación de la misma categoría (no se duplicó). El worker usa esto
   * para no insertar el cartel "Derivado al equipo" repetido.
   */
  escalationIsNew?: boolean;
}

/** Resultado de una iteracion del orquestador (una corrida del SDK). */
export interface OrchestratorResult {
  /** Texto de la respuesta final propuesta por el orquestador. */
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Modelo concreto que uso el SDK. */
  model: string;
  /** Senial de notificacion (si el orquestador invoco notify_team). */
  notification: NotificationSignal;
}

/** Veredicto del evaluator sobre una respuesta del orquestador. */
export interface EvaluationResult {
  pass: boolean;
  failedCriteria: string[];
  suggestion: string | null;
}

/**
 * Senial de notificacion al equipo, seteada por la tool notify_team.
 * Cuando `notified` es true la conversacion se entrega a un humano.
 */
export interface NotificationSignal {
  notified: boolean;
  category: NotificationCategory | null;
  reason: string | null;
  summary: string | null;
}

/**
 * Contexto mutable de una corrida del agente. Se crea en run.ts y se pasa a
 * los factories de tools y hooks para que puedan registrar steps en el trace
 * correcto y senializar la notificacion al equipo.
 */
export interface RunContext {
  traceId: string;
  conversationId: string;
  /** Iteracion actual del loop con el evaluator (1..MAX_ITERATIONS). */
  iteration: number;
  /** Contador global de steps del trace (orden de insercion). */
  stepOrder: number;
  /** Senial seteada por la tool notify_team. */
  notification: NotificationSignal;
}

export type { TraceStatus, Provider, NotificationCategory };
