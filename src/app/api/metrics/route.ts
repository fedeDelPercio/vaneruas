import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { esDescartado } from "@/lib/payments/dismiss";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/metrics?period=7d|30d|90d|all
//
// Métricas del panel para el cliente. Todo se calcula sobre las tablas que ya
// existen (RLS aísla por client_slug vía el JWT), sin instrumentación nueva:
//
//  - byCategory   : derivaciones por categoría (agent_notifications.category)
//  - messages     : conteo por rol (IA = assistant, humano = human, user = cliente)
//  - paymentFunnel: comprobantes recibidos en el período por estado actual
//  - validation   : tiempo medio entre recepción y validación
//  - pending      : comprobantes pendientes (para el backlog por días hábiles,
//                   que se computa en el cliente con un umbral ajustable)
//
// El backlog NO se filtra por período: un pendiente viejo sigue siendo backlog
// abierto sin importar la ventana que esté mirando el usuario.
// ===========================================================================

const PERIOD_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

export interface MetricsResponse {
  period: string;
  since: string | null;
  byCategory: { category: string; count: number }[];
  messages: { assistant: number; human: number; user: number };
  // Contención: a nivel conversación, cuántas resolvió la IA sola vs cuántas
  // necesitaron al equipo (derivación NO-comprobante: "la IA no supo/pudo,
  // salvo certificados"). pctAI = aiHandled / total.
  containment: {
    total: number;
    aiHandled: number;
    teamIntervention: number;
    pctAI: number | null;
  };
  paymentFunnel: {
    /** Todas las imágenes que entraron a Aprobaciones. */
    received: number;
    pending: number;
    validated: number;
    /** Rechazados de verdad: eran un pago y no sirvió. */
    rejected: number;
    /** No eran un comprobante (capturas, títulos sueltos). Ver lib/payments/dismiss. */
    descartados: number;
  };
  validation: { avgMs: number | null; count: number };
  pending: {
    id: string;
    createdAt: string;
    senderName: string | null;
    amount: number | null;
  }[];
  daily: { date: string; mensajes: number; comprobantes: number; equipo: number }[];
  // Evolución del reparto IA / equipo, por semana y por mes. Va aparte del
  // período seleccionado a propósito: es una serie de tendencia, no una foto.
  share: { semanal: SharePoint[]; mensual: SharePoint[] };
}

export interface SharePoint {
  /** Clave ordenable (inicio del bucket, YYYY-MM-DD). */
  periodo: string;
  /** Etiqueta corta para el eje ("6 oct", "octubre"). */
  label: string;
  ia: number;
  equipo: number;
  /** % de salientes que escribió la IA. null si no hubo salientes. */
  pct: number | null;
}

// PostgREST corta en 1000 filas por request. Toda query que traiga FILAS (no
// un count) tiene que paginar o el dashboard miente: con 3000 mensajes en el
// periodo veiamos solo los primeros 1000, asi que la contencion salia hundida
// (el numerador de conversaciones se truncaba y el de derivaciones no).
const PAGE = 1000;
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

// Argentina es UTC-3 todo el año: el día "del negocio" arranca a las 03:00 UTC.
const AR_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** Fecha YYYY-MM-DD en hora de Argentina. */
function arDay(d: Date): string {
  return new Date(d.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}
/** Instante UTC del arranque de ese día en Argentina. */
function arStart(day: string): string {
  return `${day}T03:00:00.000Z`;
}

interface Bucket {
  periodo: string;
  label: string;
  desde: string;
  hasta: string;
}

/** Las últimas `n` semanas (arrancan lunes), de la más vieja a la más nueva. */
function bucketsSemanales(n: number): Bucket[] {
  const hoy = new Date(`${arDay(new Date())}T00:00:00.000Z`);
  // getUTCDay: 0 = domingo. Retrocedemos al lunes de esta semana.
  const haciaLunes = (hoy.getUTCDay() + 6) % 7;
  const lunesActual = new Date(hoy.getTime() - haciaLunes * DAY_MS);
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ini = new Date(lunesActual.getTime() - i * 7 * DAY_MS);
    const fin = new Date(ini.getTime() + 7 * DAY_MS);
    const periodo = ini.toISOString().slice(0, 10);
    out.push({
      periodo,
      label: new Date(`${periodo}T12:00:00Z`).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      desde: arStart(periodo),
      hasta: arStart(fin.toISOString().slice(0, 10)),
    });
  }
  return out;
}

/** Los últimos `n` meses calendario, del más viejo al más nuevo. */
function bucketsMensuales(n: number): Bucket[] {
  const hoy = new Date(`${arDay(new Date())}T00:00:00.000Z`);
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ini = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    const fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i + 1, 1));
    const periodo = ini.toISOString().slice(0, 10);
    out.push({
      periodo,
      label: ini.toLocaleDateString("es-AR", { month: "short", timeZone: "UTC" }),
      desde: arStart(periodo),
      hasta: arStart(fin.toISOString().slice(0, 10)),
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const sb = getSupabaseServerClient();
  const period = req.nextUrl.searchParams.get("period") ?? "30d";
  const known = PERIOD_DAYS[period];
  const days: number | null = known === undefined ? 30 : known;
  const since =
    days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();

  // --- Conteos de mensajes por rol (head:true: solo el count, sin traer filas).
  const countMessages = async (role: string): Promise<number> => {
    let q = sb
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("role", role);
    if (since) q = q.gte("created_at", since);
    const { count } = await q;
    return count ?? 0;
  };

  // --- Reparto IA / equipo por bucket. Se resuelve con counts (head:true), que
  //     no traen filas y por lo tanto no sufren el tope de 1000.
  const countRole = async (role: string, desde: string, hasta: string): Promise<number> => {
    const { count } = await sb
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("role", role)
      .gte("created_at", desde)
      .lt("created_at", hasta);
    return count ?? 0;
  };
  // Desde cuándo tenemos mensajes del equipo. Antes de esa fecha el importador
  // de GHL todavía no llegó, así que un bucket viejo mostraría 100% IA cuando
  // en realidad no sabemos nada. Esos buckets van como "sin datos".
  const { data: primerHumano } = await sb
    .from("messages")
    .select("created_at")
    .eq("role", "human")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  // Se toma el arranque del DÍA del primer mensaje humano: el importador cubre
  // el día entero, aunque el primer mensaje que haya encontrado sea del mediodía.
  const coberturaDesde = primerHumano?.created_at
    ? new Date(arStart(arDay(new Date(primerHumano.created_at)))).getTime()
    : null;

  const shareDe = async (buckets: Bucket[]): Promise<SharePoint[]> =>
    Promise.all(
      buckets.map(async (b) => {
        const [ia, equipo] = await Promise.all([
          countRole("assistant", b.desde, b.hasta),
          countRole("human", b.desde, b.hasta),
        ]);
        const tot = ia + equipo;
        // Solo se informa un bucket cubierto ENTERO por el importador. Si
        // arranca antes, el conteo del equipo está incompleto y el % saldría
        // inflado (agosto marcaba 95% con un solo día de datos reales).
        const sinCobertura =
          coberturaDesde === null || new Date(b.desde).getTime() < coberturaDesde;
        return {
          periodo: b.periodo,
          label: b.label,
          ia,
          equipo,
          pct: tot === 0 || sinCobertura ? null : Math.round((ia / tot) * 100),
        };
      }),
    );
  const shareP = (async () => ({
    semanal: await shareDe(bucketsSemanales(12)),
    mensual: await shareDe(bucketsMensuales(6)),
  }))();

  // --- Comprobantes del período. Se traen las filas (no counts) porque hay que
  //     separar los RECHAZADOS de los DESCARTADOS, y eso no se puede filtrar en
  //     la query: ambos quedan como status="rejected".
  const funnelP = (async () => {
    const rows = await fetchAll<{
      status: string;
      validation_note: string | null;
      amount: number | string | null;
    }>((from, to) => {
      let q = sb
        .from("payment_validations")
        .select("status, validation_note, amount")
        .order("created_at");
      if (since) q = q.gte("created_at", since);
      return q.range(from, to);
    });
    let pending = 0;
    let validated = 0;
    let rejected = 0;
    let descartados = 0;
    for (const r of rows) {
      if (r.status === "pending") pending++;
      else if (r.status === "validated") validated++;
      else if (esDescartado(r)) descartados++;
      else rejected++;
    }
    return { received: rows.length, pending, validated, rejected, descartados };
  })();

  // --- Derivaciones por categoría (traemos solo la columna y agrupamos en JS).
  const categoriesP = (async () => {
    const data = await fetchAll<{ category: string | null }>((from, to) => {
      let q = sb.from("agent_notifications").select("category").order("created_at");
      if (since) q = q.gte("created_at", since);
      return q.range(from, to);
    });
    const counts = new Map<string, number>();
    for (const r of data) {
      const c = (r.category as string | null) ?? "(sin categoría)";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // --- Tiempo medio de validación (recepción -> validación), validados en el período.
  const validationP = (async () => {
    const rows = await fetchAll<{ created_at: string; validated_at: string }>((from, to) => {
      let q = sb
        .from("payment_validations")
        .select("created_at, validated_at")
        .eq("status", "validated")
        .not("validated_at", "is", null)
        .order("validated_at");
      if (since) q = q.gte("validated_at", since);
      return q.range(from, to);
    });
    if (!rows.length) return { avgMs: null as number | null, count: 0 };
    let total = 0;
    for (const r of rows) {
      total +=
        new Date(r.validated_at as string).getTime() -
        new Date(r.created_at as string).getTime();
    }
    return { avgMs: Math.round(total / rows.length), count: rows.length };
  })();

  // --- Comprobantes pendientes (para el backlog; sin filtro de período).
  const pendingP = (async () => {
    const data = await fetchAll<Record<string, unknown>>((from, to) =>
      sb
        .from("payment_validations")
        .select("id, created_at, sender_name, amount")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    return data.map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      senderName: (r.sender_name as string | null) ?? null,
      amount: r.amount === null ? null : Number(r.amount),
    }));
  })();

  // --- Filas para la serie diaria + contención. De mensajes traemos también
  //     conversation_id para contar conversaciones distintas (excluye carteles
  //     de sistema). De comprobantes solo el timestamp para la serie diaria.
  const msgRowsP = fetchAll<{
    created_at: string;
    conversation_id: string | null;
    role: string;
  }>((from, to) => {
      let q = sb
        .from("messages")
        .select("created_at, conversation_id, role")
        .neq("role", "system")
        .order("created_at");
      if (since) q = q.gte("created_at", since);
      return q.range(from, to);
  });
  const payTimestampsP = (async () => {
    const data = await fetchAll<{ created_at: string }>((from, to) => {
      let q = sb.from("payment_validations").select("created_at").order("created_at");
      if (since) q = q.gte("created_at", since);
      return q.range(from, to);
    });
    return data.map((r) => r.created_at);
  })();
  // Conversaciones que necesitaron al equipo: derivaciones NO-comprobante
  // (la IA no supo/pudo). Los comprobantes (validacion_pago) NO cuentan.
  const intervConvP = fetchAll<{ conversation_id: string | null }>((from, to) => {
    let q = sb
      .from("agent_notifications")
      .select("conversation_id")
      .neq("category", "validacion_pago")
      .order("created_at");
    if (since) q = q.gte("created_at", since);
    return q.range(from, to);
  });

  const [byCategory, assistant, human, user, funnel, validation, pending, msgRows, payTs, intervRows, share] =
    await Promise.all([
      categoriesP,
      countMessages("assistant"),
      countMessages("human"),
      countMessages("user"),
      funnelP,
      validationP,
      pendingP,
      msgRowsP,
      payTimestampsP,
      intervConvP,
      shareP,
    ]);


  // Contención a nivel conversación. total = conversaciones con actividad en el
  // período (∪ las que tienen derivación). teamIntervention = conversaciones
  // con una derivación no-comprobante. aiHandled = el resto.
  const totalConvSet = new Set<string>();
  for (const r of msgRows) if (r.conversation_id) totalConvSet.add(r.conversation_id as string);
  const intervConvSet = new Set<string>();
  for (const r of intervRows) {
    if (r.conversation_id) {
      intervConvSet.add(r.conversation_id as string);
      totalConvSet.add(r.conversation_id as string);
    }
  }
  const total = totalConvSet.size;
  const teamIntervention = intervConvSet.size;
  const aiHandled = total - teamIntervention;
  const pctAI = total === 0 ? null : Math.round((aiHandled / total) * 100);

  const msgTs = msgRows.map((r) => r.created_at as string);
  const equipoTs = msgRows.filter((r) => r.role === "human").map((r) => r.created_at);

  const body: MetricsResponse = {
    period,
    since,
    byCategory,
    messages: { assistant, human, user },
    containment: { total, aiHandled, teamIntervention, pctAI },
    paymentFunnel: funnel,
    validation,
    pending,
    daily: buildDailySeries(msgTs, payTs, equipoTs, days),
    share,
  };

  return NextResponse.json(body);
}

// Construye la serie diaria continua (un punto por día, con ceros en los días
// sin actividad) para el rango del período. Bucketea por fecha UTC, que para
// AR (sin DST) es una aproximación suficiente para un dashboard.
function buildDailySeries(
  msgTs: string[],
  payTs: string[],
  equipoTs: string[],
  days: number | null,
): { date: string; mensajes: number; comprobantes: number; equipo: number }[] {
  const DAY = 86_400_000;
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const bucket = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const t of arr) {
      const k = key(new Date(t));
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const msgBy = bucket(msgTs);
  const payBy = bucket(payTs);
  const eqBy = bucket(equipoTs);
  const todayKey = key(new Date());

  let start: Date;
  if (days !== null) {
    start = new Date(Date.now() - (days - 1) * DAY);
  } else {
    const times = [...msgTs, ...payTs].map((t) => new Date(t).getTime());
    start = times.length ? new Date(times.reduce((a, b) => Math.min(a, b))) : new Date();
  }

  const out: { date: string; mensajes: number; comprobantes: number; equipo: number }[] = [];
  let cur = new Date(`${key(start)}T00:00:00.000Z`);
  for (let i = 0; i < 400; i++) {
    const k = key(cur);
    out.push({
      date: k,
      mensajes: msgBy.get(k) ?? 0,
      comprobantes: payBy.get(k) ?? 0,
      equipo: eqBy.get(k) ?? 0,
    });
    if (k === todayKey) break;
    cur = new Date(cur.getTime() + DAY);
  }
  return out;
}
