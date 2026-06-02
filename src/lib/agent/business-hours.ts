// ===========================================================================
// Contexto de horario comercial para el agente.
//
// Horario default: Lunes a Viernes, 9 a 18 hs, hora de Argentina. Ajustá las
// constantes BUSINESS_START_HOUR / BUSINESS_END_HOUR y la TZ si el cliente
// atiende en otro horario o zona. El orquestador recibe este contexto en
// cada corrida y decide, según su prompt, cómo ajustarse (identidad fuera
// de horario, aviso de re-contacto al día siguiente, etc).
// ===========================================================================

const TZ = "America/Argentina/Buenos_Aires";
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18; // exclusivo: 18:00 ya es fuera de horario

// Nombres tal cual los devuelve Intl con locale es-AR (con tildes).
const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

export interface TimeContext {
  /** Fecha y hora local formateada (para mostrar e inyectar al prompt). */
  localTime: string;
  /** Dia de la semana en minusculas y sin tilde (ej: "miercoles"). */
  dayName: string;
  /** true si estamos dentro del horario comercial. */
  isBusinessHours: boolean;
  /**
   * Cuando ofrecer el contacto de Santino, ya resuelto: "por la tarde",
   * "mañana" o "el lunes". Lo calcula el codigo (deterministico) para que el
   * modelo no tenga que razonar el dia de la semana — antes confundia
   * "viernes a la mañana" con "el lunes".
   */
  followUpTiming: string;
}

/**
 * Calcula cuando ofrecer el contacto de Santino segun dia y hora:
 *   - dia habil antes de las 12:00       -> "por la tarde" (hoy)
 *   - viernes 12:00 o mas tarde          -> "el lunes" (mañana seria sabado)
 *   - lun a jue 12:00 o mas tarde        -> "mañana"
 *   - sabado o domingo                   -> "el lunes"
 */
function computeFollowUpTiming(dayIdx: number, hour: number): string {
  const isWeekend = dayIdx === 0 || dayIdx === 6;
  if (isWeekend) return "el lunes";
  if (hour < 12) return "por la tarde";
  if (dayIdx === 5) return "el lunes"; // viernes pasado el mediodia
  return "mañana"; // lunes a jueves pasado el mediodia
}

/** Calcula el contexto de horario en zona horaria de Argentina. */
export function getTimeContext(now: Date = new Date()): TimeContext {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekday = get("weekday").toLowerCase();
  const hour = parseInt(get("hour"), 10);
  const minute = get("minute");

  const dayIdx = WEEKDAYS.indexOf(weekday);
  const isWeekday = dayIdx >= 1 && dayIdx <= 5;
  const isBusinessHours =
    isWeekday && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;

  return {
    localTime: `${get("day")}/${get("month")}/${get("year")} ${String(hour).padStart(2, "0")}:${minute}`,
    dayName: weekday,
    isBusinessHours,
    followUpTiming: computeFollowUpTiming(dayIdx, hour),
  };
}

/** Bloque de texto con el contexto de horario para inyectar al prompt. */
export function timeContextBlock(tc: TimeContext): string {
  return [
    "=== Contexto de horario ===",
    `Ahora es ${tc.dayName} ${tc.localTime} (hora de Argentina).`,
    tc.isBusinessHours
      ? "Estás DENTRO del horario comercial (Lun a Vie, 9 a 18 hs)."
      : "Estás FUERA del horario comercial (Lun a Vie, 9 a 18 hs).",
    "",
    `CUÁNDO OFRECER EL CONTACTO DE SANTINO: "${tc.followUpTiming}". Usá`,
    "exactamente este valor en la invitación a llamada y en el cierre de",
    "interes_compra. No lo recalcules vos: ya está resuelto acá.",
  ].join("\n");
}
