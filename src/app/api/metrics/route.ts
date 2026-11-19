import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { esCierreMasivo } from "@/lib/payments/dismiss";
import { HUMAN_WAITING_REASON } from "@/lib/team-interventions";
import {
  arDay,
  arStart,
  automationRate,
  average,
  buildApprovalsDaily,
  buildKpi,
  buildPaymentFunnel,
  comprobantesRecibidos,
  countByDay,
  DAY_MS,
  inRange,
  metricWindow,
  rateByWeek,
  weekKeys,
  type ApprovalDay,
  type KpiData,
  type MetricsPaymentRow,
  type PaymentFunnel,
} from "@/lib/metrics/series";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET /api/metrics?period=7d|30d|90d
//
// Métricas del panel para el cliente. Todo se calcula sobre las tablas que ya
// existen, sin instrumentación nueva. Cada query filtra por client_slug de
// forma explícita además de la RLS.
//
//  - kpis          : tarjetas de arriba. Cada una trae total, total del período
//                    anterior de igual largo, variación % y serie para la
//                    mini tendencia (diaria; semanal en automatización; sin
//                    serie en tiempo de validación).
//  - byCategory    : derivaciones por categoría (agent_notifications.category)
//  - messages      : conteo por rol (IA = assistant, humano = human, user = cliente)
//  - paymentFunnel : comprobantes recibidos en el período por estado actual
//  - validation    : tiempo medio entre recepción y validación
//  - pending       : comprobantes pendientes (backlog por días hábiles, que se
//                    computa en el cliente con un umbral ajustable)
//  - approvalsDaily: revisiones del equipo por día (comprobantes y títulos)
//
// El backlog NO se filtra por período: un pendiente viejo sigue siendo backlog
// abierto sin importar la ventana que esté mirando el usuario.
//
// El cierre masivo del 18/11 (esCierreMasivo): esos comprobantes SÍ llegaron,
// así que cuentan como recibidos (tarjeta y total del embudo, en fila aparte).
// No fue una revisión en el panel ni un rechazo/descarte real: queda afuera de
// rechazados, descartados, tiempo de validación, aprobaciones del equipo, tasa
// de aprobación y donut de confirmados.
// ===========================================================================

// "La contacta escribió con la IA en pausa" la abre el sistema, no es una
// derivación del agente: no cuenta en las métricas de derivaciones.
const NOT_HUMAN_WAITING = `reason.is.null,reason.neq.${HUMAN_WAITING_REASON}`;

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

export interface MetricsResponse {
  period: string;
  since: string;
  kpis: {
    /** Tasa de automatización por mensajes: IA / (IA + equipo), en %. */
    automation: KpiData & {
      ai: number;
      human: number;
      /** Desde cuándo tenemos registro de los mensajes del equipo. */
      coberturaDesde: string | null;
      /** false si el período empieza antes de esa fecha: el número queda alto. */
      cubierto: boolean;
    };
    /** Comprobantes recibidos (sin agrupados ni descartados; con cierre masivo). */
    received: KpiData & { pending: number; descartados: number; cierreMasivo: number };
    /** Tiempo medio de validación en ms. Subir es malo. Sin serie (sin sparkline). */
    validation: KpiData & { count: number };
    /** Pendientes abiertos (sin período). El umbral se aplica en el cliente. */
    backlog: KpiData;
  };
  byCategory: { category: string; count: number }[];
  messages: { assistant: number; human: number; user: number };
  paymentFunnel: PaymentFunnel;
  validation: { avgMs: number | null; count: number };
  pending: {
    id: string;
    createdAt: string;
    senderName: string | null;
    amount: number | null;
  }[];
  daily: { date: string; mensajes: number; equipo: number }[];
  approvalsDaily: ApprovalDay[];
  // Evolución del reparto IA / equipo, por semana y por mes. Va aparte del
  // período seleccionado a propósito: es una serie de tendencia, no una foto.
  share: { semanal: SharePoint[]; mensual: SharePoint[] };
}

export interface SharePoint {
  /** Clave ordenable (inicio del bucket, YYYY-MM-DD). */
  periodo: string;
  /** Etiqueta corta para el eje ("6 oct", "oct"). */
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
  const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;
  const requested = req.nextUrl.searchParams.get("period") ?? "30d";
  const period = requested in PERIOD_DAYS ? requested : "30d";
  const days = PERIOD_DAYS[period]!;
  const { keys, since, prevSince } = metricWindow(days);
  // Semanas de la mini tendencia de automatización (pueden arrancar antes del
  // período: con 7 días se muestran 8 semanas).
  const weeks = weekKeys(days);
  const msgSince = arStart(weeks[0]!) < since ? arStart(weeks[0]!) : since;

  // --- Conteo de mensajes por rol en [desde, hasta). head:true: solo el count,
  //     sin traer filas, así que no sufre el tope de 1000.
  const countRole = async (role: string, desde: string, hasta?: string): Promise<number> => {
    let q = sb
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("client_slug", slug)
      .eq("role", role)
      .gte("created_at", desde);
    if (hasta) q = q.lt("created_at", hasta);
    const { count } = await q;
    return count ?? 0;
  };

  // Desde cuándo tenemos mensajes del equipo. Antes de esa fecha el importador
  // de GHL todavía no llegó, así que un tramo viejo mostraría 100% IA cuando
  // en realidad no sabemos nada. Esos tramos van como "sin datos".
  const { data: primerHumano } = await sb
    .from("messages")
    .select("created_at")
    .eq("client_slug", slug)
    .eq("role", "human")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  // Se toma el arranque del DÍA del primer mensaje humano: el importador cubre
  // el día entero, aunque el primer mensaje que haya encontrado sea del mediodía.
  const coberturaDesde = primerHumano?.created_at
    ? new Date(arStart(arDay(new Date(primerHumano.created_at)))).getTime()
    : null;
  const cubre = (desde: string) =>
    coberturaDesde !== null && new Date(desde).getTime() >= coberturaDesde;

  const shareDe = async (buckets: Bucket[]): Promise<SharePoint[]> =>
    Promise.all(
      buckets.map(async (b) => {
        const [ia, equipo] = await Promise.all([
          countRole("assistant", b.desde, b.hasta),
          countRole("human", b.desde, b.hasta),
        ]);
        // Solo se informa un bucket cubierto ENTERO por el importador. Si
        // arranca antes, el conteo del equipo está incompleto y el % saldría
        // inflado (agosto marcaba 95% con un solo día de datos reales).
        const pct = cubre(b.desde) ? automationRate(ia, equipo) : null;
        return { periodo: b.periodo, label: b.label, ia, equipo, pct: pct === null ? null : Math.round(pct) };
      }),
    );
  const shareP = (async () => ({
    semanal: await shareDe(bucketsSemanales(12)),
    mensual: await shareDe(bucketsMensuales(6)),
  }))();

  // --- Comprobantes RECIBIDOS en el período actual y el anterior (por
  //     created_at). Filas y no counts: hay que separar rechazados de
  //     descartados, agrupados y cierre masivo, y nada de eso se filtra en SQL.
  const payRowsP = fetchAll<MetricsPaymentRow>((from, to) =>
    sb
      .from("payment_validations")
      .select("id, conversation_id, event_slug, operation_number, created_at, status, validation_note, amount")
      .eq("client_slug", slug)
      .gte("created_at", prevSince)
      .order("created_at")
      .order("id")
      .range(from, to),
  );

  // --- Comprobantes RESUELTOS en el período actual y el anterior (por
  //     validated_at): tiempo de validación y aprobaciones del equipo. Va aparte
  //     porque un comprobante viejo puede resolverse dentro de la ventana.
  const resolvedRowsP = fetchAll<{
    status: string;
    created_at: string;
    validated_at: string | null;
    validation_note: string | null;
  }>((from, to) =>
    sb
      .from("payment_validations")
      .select("status, created_at, validated_at, validation_note")
      .eq("client_slug", slug)
      .in("status", ["validated", "rejected"])
      .not("validated_at", "is", null)
      .gte("validated_at", prevSince)
      .order("validated_at")
      .order("id")
      .range(from, to),
  );

  // --- Títulos revisados por el equipo en el período (por reviewed_at).
  const titlesP = fetchAll<{ reviewed_at: string | null; validation_note: string | null }>((from, to) =>
    sb
      .from("professional_titles")
      .select("reviewed_at, validation_note")
      .eq("client_slug", slug)
      .not("reviewed_at", "is", null)
      .gte("reviewed_at", since)
      .order("reviewed_at")
      .order("id")
      .range(from, to),
  );

  // --- Derivaciones por categoría (traemos solo la columna y agrupamos en JS).
  const categoriesP = (async () => {
    const data = await fetchAll<{ category: string | null }>((from, to) =>
      sb
        .from("agent_notifications")
        .select("category")
        .eq("client_slug", slug)
        .or(NOT_HUMAN_WAITING)
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(from, to),
    );
    const counts = new Map<string, number>();
    for (const r of data) {
      const c = r.category ?? "(sin categoría)";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // --- Comprobantes pendientes (para el backlog; sin filtro de período).
  const pendingP = (async () => {
    const data = await fetchAll<{
      id: string;
      created_at: string;
      sender_name: string | null;
      amount: number | string | null;
    }>((from, to) =>
      sb
        .from("payment_validations")
        .select("id, created_at, sender_name, amount")
        .eq("client_slug", slug)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .order("id")
        .range(from, to),
    );
    return data.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      senderName: r.sender_name ?? null,
      amount: r.amount === null ? null : Number(r.amount),
    }));
  })();

  // --- Mensajes (sin carteles de sistema) desde el arranque de la primera
  //     semana de la mini tendencia o del período, lo que sea antes: series
  //     diarias de actividad y del equipo (filtradas al período) y la tasa de
  //     automatización por semana.
  const msgRowsP = fetchAll<{ created_at: string; role: string }>((from, to) =>
    sb
      .from("messages")
      .select("created_at, role")
      .eq("client_slug", slug)
      .neq("role", "system")
      .gte("created_at", msgSince)
      .order("created_at")
      .order("id")
      .range(from, to),
  );

  const [
    byCategory,
    assistant,
    human,
    user,
    prevAssistant,
    prevHuman,
    payRows,
    resolvedRows,
    titles,
    pending,
    msgRows,
    share,
  ] = await Promise.all([
    categoriesP,
    countRole("assistant", since),
    countRole("human", since),
    countRole("user", since),
    countRole("assistant", prevSince, since),
    countRole("human", prevSince, since),
    payRowsP,
    resolvedRowsP,
    titlesP,
    pendingP,
    msgRowsP,
    shareP,
  ]);

  // --- Embudo del período actual. Afuera: imágenes agrupadas (son el mismo
  //     comprobante que su canónico). Los pendientes se cuentan por grupo (3
  //     capturas de la misma transferencia = 1). El cierre masivo se separa
  //     ANTES de mirar descartados: esas filas quedaron rejected y a veces sin
  //     monto, y esDescartado las tomaría como descartes. Ver buildPaymentFunnel.
  const curPay = payRows.filter((r) => inRange(r.created_at, since));
  const prevPay = payRows.filter((r) => inRange(r.created_at, prevSince, since));
  const funnel = buildPaymentFunnel(curPay);

  // --- KPI comprobantes recibidos (= total "Recibidos" del embudo).
  const recibidosTs = comprobantesRecibidos(curPay);
  const prevRecibidosTs = comprobantesRecibidos(prevPay);
  const receivedSeries = countByDay(recibidosTs, keys);

  // --- KPI tiempo medio de validación: validados (sin cierre masivo) con
  //     validated_at en el período. Sin serie: la tarjeta no lleva sparkline.
  const tiempos = resolvedRows
    .filter((r) => r.status === "validated" && !esCierreMasivo(r))
    .map((r) => ({
      at: r.validated_at!,
      ms: new Date(r.validated_at!).getTime() - new Date(r.created_at).getTime(),
    }));
  const curTiempos = tiempos.filter((t) => inRange(t.at, since));
  const prevTiempos = tiempos.filter((t) => inRange(t.at, prevSince, since));
  const avgMs = average(curTiempos.map((t) => t.ms));

  // --- KPI tasa de automatización por mensajes. El número y el delta son del
  //     período; la mini tendencia es semanal.
  const aiTs = msgRows.filter((r) => r.role === "assistant").map((r) => r.created_at);
  const equipoTs = msgRows.filter((r) => r.role === "human").map((r) => r.created_at);
  const curMsgRows = msgRows.filter((r) => inRange(r.created_at, since));
  const automationTotal = automationRate(assistant, human);
  // El anterior solo es comparable si el registro del equipo ya lo cubría.
  const automationPrev = cubre(prevSince) ? automationRate(prevAssistant, prevHuman) : null;

  // countByDay ignora lo que cae fuera de `keys`, pero filtramos igual para
  // que se lea que estas series son del período.
  const mensajesPorDia = countByDay(curMsgRows.map((r) => r.created_at), keys);
  const equipoPorDia = countByDay(
    curMsgRows.filter((r) => r.role === "human").map((r) => r.created_at),
    keys,
  );
  const daily = keys.map((date, i) => ({
    date,
    mensajes: mensajesPorDia[i]!,
    equipo: equipoPorDia[i]!,
  }));

  const body: MetricsResponse = {
    period,
    since,
    kpis: {
      automation: {
        ...buildKpi(automationTotal, automationPrev, weeks, rateByWeek(aiTs, equipoTs, weeks, coberturaDesde)),
        ai: assistant,
        human,
        coberturaDesde: coberturaDesde ? new Date(coberturaDesde).toISOString() : null,
        cubierto: cubre(since),
      },
      received: {
        ...buildKpi(recibidosTs.length, prevRecibidosTs.length, keys, receivedSeries),
        pending: funnel.pending,
        descartados: funnel.descartados,
        cierreMasivo: funnel.cierreMasivo,
      },
      validation: {
        ...buildKpi(avgMs, average(prevTiempos.map((t) => t.ms)), [], []),
        count: curTiempos.length,
      },
      backlog: buildKpi(pending.length, null, [], []),
    },
    byCategory,
    messages: { assistant, human, user },
    paymentFunnel: funnel,
    validation: { avgMs, count: curTiempos.length },
    pending,
    daily,
    approvalsDaily: buildApprovalsDaily(
      resolvedRows.filter((r) => r.validated_at && inRange(r.validated_at, since)),
      titles,
      keys,
    ),
    share,
  };

  return NextResponse.json(body);
}
