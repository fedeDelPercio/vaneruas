import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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
    received: number;
    pending: number;
    validated: number;
    rejected: number;
  };
  validation: { avgMs: number | null; count: number };
  pending: {
    id: string;
    createdAt: string;
    senderName: string | null;
    amount: number | null;
  }[];
  daily: { date: string; mensajes: number; comprobantes: number }[];
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

  // --- Conteos de comprobantes por estado (recibidos en el período).
  const countPayments = async (status?: string): Promise<number> => {
    let q = sb.from("payment_validations").select("*", { count: "exact", head: true });
    if (status) q = q.eq("status", status);
    if (since) q = q.gte("created_at", since);
    const { count } = await q;
    return count ?? 0;
  };

  // --- Derivaciones por categoría (traemos solo la columna y agrupamos en JS).
  const categoriesP = (async () => {
    let q = sb.from("agent_notifications").select("category");
    if (since) q = q.gte("created_at", since);
    const { data } = await q;
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      const c = (r.category as string | null) ?? "(sin categoría)";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // --- Tiempo medio de validación (recepción -> validación), validados en el período.
  const validationP = (async () => {
    let q = sb
      .from("payment_validations")
      .select("created_at, validated_at")
      .eq("status", "validated")
      .not("validated_at", "is", null);
    if (since) q = q.gte("validated_at", since);
    const { data } = await q;
    const rows = data ?? [];
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
    const { data } = await sb
      .from("payment_validations")
      .select("id, created_at, sender_name, amount")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    return (data ?? []).map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      senderName: (r.sender_name as string | null) ?? null,
      amount: r.amount === null ? null : Number(r.amount),
    }));
  })();

  // --- Filas para la serie diaria + contención. De mensajes traemos también
  //     conversation_id para contar conversaciones distintas (excluye carteles
  //     de sistema). De comprobantes solo el timestamp para la serie diaria.
  const msgRowsP = (async () => {
    let q = sb.from("messages").select("created_at, conversation_id").neq("role", "system");
    if (since) q = q.gte("created_at", since);
    const { data } = await q;
    return data ?? [];
  })();
  const payTimestampsP = (async () => {
    let q = sb.from("payment_validations").select("created_at");
    if (since) q = q.gte("created_at", since);
    const { data } = await q;
    return (data ?? []).map((r) => r.created_at as string);
  })();
  // Conversaciones que necesitaron al equipo: derivaciones NO-comprobante
  // (la IA no supo/pudo). Los comprobantes (validacion_pago) NO cuentan.
  const intervConvP = (async () => {
    let q = sb
      .from("agent_notifications")
      .select("conversation_id")
      .neq("category", "validacion_pago");
    if (since) q = q.gte("created_at", since);
    const { data } = await q;
    return data ?? [];
  })();

  const [byCategory, assistant, human, user, funnel, validation, pending, msgRows, payTs, intervRows] =
    await Promise.all([
      categoriesP,
      countMessages("assistant"),
      countMessages("human"),
      countMessages("user"),
      Promise.all([
        countPayments(),
        countPayments("pending"),
        countPayments("validated"),
        countPayments("rejected"),
      ]),
      validationP,
      pendingP,
      msgRowsP,
      payTimestampsP,
      intervConvP,
    ]);

  const [received, pendingCount, validated, rejected] = funnel;

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

  const body: MetricsResponse = {
    period,
    since,
    byCategory,
    messages: { assistant, human, user },
    containment: { total, aiHandled, teamIntervention, pctAI },
    paymentFunnel: { received, pending: pendingCount, validated, rejected },
    validation,
    pending,
    daily: buildDailySeries(msgTs, payTs, days),
  };

  return NextResponse.json(body);
}

// Construye la serie diaria continua (un punto por día, con ceros en los días
// sin actividad) para el rango del período. Bucketea por fecha UTC, que para
// AR (sin DST) es una aproximación suficiente para un dashboard.
function buildDailySeries(
  msgTs: string[],
  payTs: string[],
  days: number | null,
): { date: string; mensajes: number; comprobantes: number }[] {
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
  const todayKey = key(new Date());

  let start: Date;
  if (days !== null) {
    start = new Date(Date.now() - (days - 1) * DAY);
  } else {
    const times = [...msgTs, ...payTs].map((t) => new Date(t).getTime());
    start = times.length ? new Date(times.reduce((a, b) => Math.min(a, b))) : new Date();
  }

  const out: { date: string; mensajes: number; comprobantes: number }[] = [];
  let cur = new Date(`${key(start)}T00:00:00.000Z`);
  for (let i = 0; i < 400; i++) {
    const k = key(cur);
    out.push({ date: k, mensajes: msgBy.get(k) ?? 0, comprobantes: payBy.get(k) ?? 0 });
    if (k === todayKey) break;
    cur = new Date(cur.getTime() + DAY);
  }
  return out;
}
