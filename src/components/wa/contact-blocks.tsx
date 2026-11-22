"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AtSign,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  CloudOff,
  Flag,
  KeyRound,
  Loader2,
  MailX,
  UserRound,
} from "lucide-react";
import type { ContactNotification } from "@/app/api/wa/contact/[conversationId]/route";
import {
  tiendupEditorMode,
  type TiendupAccessStatus,
  type TiendupMailStatus,
  type TiendupStatusResponse,
} from "@/lib/tiendup/status";
import { TiendupEmailEditor } from "./TiendupEmailEditor";

// Bloques compartidos de la ficha del contacto (/wa, ContactPanel) y de la
// columna derecha de /revision (ReviewDetail): títulos de sección, lista con
// "Ver más", intervención con su detalle, estado del título y el bloque de
// Tiendup en vivo.

export type Tone = "ok" | "warn" | "bad" | "idle";

/** Título de sección: text-[11px] uppercase muted, con separador neutro arriba. */
export function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-neutral-200 px-4 py-4 dark:border-neutral-800 ${className}`}>
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Subtítulo dentro de una sección (categorías del historial). */
export function SubHeading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
      {children}
      {count !== undefined && <span className="font-mono tabular-nums">{count}</span>}
    </h4>
  );
}

/**
 * Lista que muestra los `limit` primeros (ya ordenados del más reciente al más
 * viejo) y un botón "Ver más (N)" que despliega el resto; después, "Ver menos".
 */
export function ShowMoreList<T>({
  items,
  limit = 3,
  render,
  className = "space-y-2.5",
}: {
  items: T[];
  limit?: number;
  render: (item: T) => ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, items.length - limit);
  const visible = expanded ? items : items.slice(0, limit);
  return (
    <>
      <div className={className}>{visible.map(render)}</div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11.5px] font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          {expanded ? "Ver menos" : `Ver más (${hidden})`}
          <ChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </button>
      )}
    </>
  );
}

export function StatusLine({ tone, children }: { tone: Tone; children: ReactNode }) {
  const dot =
    tone === "ok"
      ? "bg-ok"
      : tone === "warn"
        ? "bg-warn"
        : tone === "bad"
          ? "bg-red-500"
          : "bg-neutral-300 dark:bg-neutral-700";
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

// --- Fechas -----------------------------------------------------------------

export function fmtShortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

/** "hace 5 min", "hace 3 h", "ayer", "hace 4 días". */
export function fmtRelative(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}

/** "18/11/2026 14:30". */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

// --- Intervenciones ---------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  fuera_de_conocimiento: "Fuera de conocimiento",
  escalado_manual: "Escalado manual",
  reclamo_certificado: "Reclamo de certificado",
  cliente_existente: "Cliente existente",
  interes_compra: "Interés de compra",
  falla_tecnica: "Falla técnica",
};

// Marcas de sistema en `reason` (no las escribe el agente). Mismas que
// src/lib/tiendup/messages.ts y src/lib/team-interventions.ts.
function systemReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.startsWith("tiendup_alta_pendiente_")) return "Alta en Tiendup pendiente";
  if (reason.startsWith("tiendup_aviso_sin_enviar_")) return "Aviso de acceso sin enviar";
  if (reason === "humano_sin_respuesta") return "Escribió con la IA en pausa";
  return null;
}

function humanize(snake: string): string {
  const s = snake.replace(/_/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** Título legible de una notificación: la marca de sistema si la tiene, si no la categoría. */
export function notificationLabel(n: Pick<ContactNotification, "category" | "reason">): string {
  return systemReasonLabel(n.reason) ?? CATEGORY_LABELS[n.category] ?? humanize(n.category);
}

/**
 * Motivo legible: el texto del agente tal cual (o humanizado si vino en
 * snake_case). Las marcas de sistema ya van en el título, así que no se repiten.
 */
export function reasonText(reason: string | null): string | null {
  const r = reason?.trim();
  if (!r || systemReasonLabel(r)) return null;
  return /^[a-z0-9_]+$/.test(r) ? humanize(r) : r;
}

/** Una intervención con su detalle completo: categoría, motivo, cuándo y el resumen. */
export function InterventionItem({ n, open }: { n: ContactNotification; open: boolean }) {
  const reason = reasonText(n.reason);
  return (
    <div className="flex items-start gap-2.5">
      <Flag
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${open ? "text-orange-600 dark:text-orange-500" : "text-neutral-400 dark:text-neutral-500"}`}
        strokeWidth={open ? 2 : 1.75}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium leading-snug text-neutral-800 dark:text-neutral-100">
          {notificationLabel(n)}
        </p>
        <p
          title={fmtDateTime(n.createdAt)}
          className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500"
        >
          {fmtRelative(n.createdAt)} · {fmtDateTime(n.createdAt)}
        </p>
        {reason && (
          <p className="mt-1 text-[11.5px] leading-snug text-neutral-600 dark:text-neutral-300">
            <span className="text-neutral-400 dark:text-neutral-500">Motivo: </span>
            {reason}
          </p>
        )}
        {n.summary && (
          <p className="mt-1 whitespace-pre-line break-words text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {n.summary}
          </p>
        )}
        {!open && n.resolvedAt && (
          <div className="mt-1">
            <StatusLine tone="ok">Atendida el {fmtShortDate(n.resolvedAt)}</StatusLine>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Título profesional -----------------------------------------------------

export type TitleStage = "none" | "valid" | "review" | "rejected";

export const TITLE_STATUS: Record<TitleStage, { text: string; tone: Tone }> = {
  valid: { text: "Validado", tone: "ok" },
  review: { text: "Pendiente", tone: "warn" },
  rejected: { text: "Rechazado", tone: "bad" },
  none: { text: "No enviado", tone: "idle" },
};

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok-fg dark:text-ok",
  warn: "text-warn-fg dark:text-warn",
  bad: "text-red-700 dark:text-red-400",
  idle: "text-neutral-500 dark:text-neutral-400",
};

/** Línea del estado del título: "Título profesional · Validado", con color por estado. */
export function TitleStatusRow({
  stage,
  detail,
}: {
  stage: TitleStage;
  /** Nombre leído, institución o aclaración (p.ej. "ya estaba registrada"). */
  detail?: string | null;
}) {
  const st = TITLE_STATUS[stage];
  return (
    <div className="flex items-center gap-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-800 dark:text-neutral-100">
          Título profesional
          <span className="text-neutral-300 dark:text-neutral-700">·</span>
          <span className={`flex items-center gap-1.5 ${TONE_TEXT[st.tone]}`}>
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                st.tone === "ok"
                  ? "bg-ok"
                  : st.tone === "warn"
                    ? "bg-warn"
                    : st.tone === "bad"
                      ? "bg-red-500"
                      : "bg-neutral-300 dark:bg-neutral-700"
              }`}
            />
            {st.text}
          </span>
        </p>
        {detail && (
          <p className="mt-0.5 truncate text-[11.5px] text-neutral-500 dark:text-neutral-400" title={detail}>
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

// --- Tiendup en vivo ----------------------------------------------------------

export type TiendupFetch =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; data: TiendupStatusResponse }
  | { phase: "failed" };

/**
 * Pide el estado de Tiendup UNA vez por conversación, cuando la ficha dice que
 * corresponde (`enabled`). No se repite con el realtime de la ficha: el
 * listado de Tiendup tiene cache de 5 min en el server y no cambia por un
 * evento de la base. `refresh()` lo vuelve a pedir a mano (tras guardar el
 * mail o dar el alta desde el bloque); mientras tanto se sigue mostrando el
 * estado anterior.
 */
export function useTiendupStatus(
  conversationId: string | null,
  enabled: boolean,
): { status: TiendupFetch; refresh: () => void } {
  const [state, setState] = useState<{ convId: string | null; value: TiendupFetch }>({
    convId: null,
    value: { phase: "idle" },
  });
  const [nonce, setNonce] = useState(0);
  // Ya se pidió para esta conversación (y este refresh): el realtime de la
  // ficha no lo repite.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !enabled) return;
    const key = `${conversationId}:${nonce}`;
    if (requested.current === key) return;
    requested.current = key;
    const convId = conversationId;
    // Primera carga: "Consultando…". Refresh: se deja el estado anterior.
    setState((prev) =>
      prev.convId === convId && prev.value.phase === "done" ? prev : { convId, value: { phase: "loading" } },
    );
    fetch(`/api/wa/tiendup-status/${convId}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        const value: TiendupFetch =
          !r.ok || !j ? { phase: "failed" } : { phase: "done", data: j as TiendupStatusResponse };
        // Si mientras tanto se cambió de conversación (u otro refresh), se descarta.
        if (requested.current !== key) return;
        setState((prev) => (prev.convId === convId ? { convId, value } : prev));
      })
      .catch(() => {
        if (requested.current !== key) return;
        setState((prev) => (prev.convId === convId ? { convId, value: { phase: "failed" } } : prev));
      });
  }, [conversationId, enabled, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { status: state.convId === conversationId ? state.value : { phase: "idle" }, refresh };
}

type LiveTone = "ok" | "warn" | "bad" | "idle";
type LiveLine = { text: string; detail?: string | null; tone: LiveTone; Icon: typeof CircleCheck; mono?: boolean };

/** Línea 1: el mail en Tiendup (independiente del evento). */
function mailLine(m: TiendupMailStatus): LiveLine {
  switch (m.state) {
    case "has_courses":
      return {
        text: "Mail validado en Tiendup",
        detail: `Ya tiene otros cursos: ${m.courses.join(" · ")}`,
        tone: "ok",
        Icon: CircleCheck,
      };
    case "customer_no_courses":
      return { text: "Mail validado en Tiendup", detail: "Cliente de la tienda, sin cursos", tone: "ok", Icon: UserRound };
    case "other_email":
      return {
        text: "El mail no figura; mismo nombre con otro mail",
        detail: m.otherEmailMasked ? `Figura como ${m.otherEmailMasked}` : null,
        tone: "warn",
        Icon: AtSign,
      };
    case "not_found":
      return { text: "El mail no figura en Tiendup", tone: "bad", Icon: MailX };
    case "no_email":
      return { text: "Sin mail guardado", detail: "Cargalo abajo para poder dar el acceso", tone: "warn", Icon: MailX };
    default:
      return { text: "No se pudo validar el mail en Tiendup", tone: "idle", Icon: CloudOff };
  }
}

/** Línea 2: acceso a la inscripción actual (curso del evento de ese pago). */
function accessLine(c: TiendupAccessStatus): LiveLine {
  const ev = c.eventTitle;
  switch (c.state) {
    case "enrolled":
      return { text: `Acceso enviado a Tiendup para ${ev}`, detail: "Figura inscripta en ese curso", tone: "ok", Icon: CircleCheck };
    case "granted":
      return { text: `Acceso enviado a Tiendup para ${ev}`, detail: "Alta registrada; no se pudo releer el curso", tone: "ok", Icon: CircleCheck };
    case "granted_missing":
      return { text: `Alta marcada para ${ev}, pero no figura en el curso`, tone: "warn", Icon: CircleAlert };
    case "other_email":
      return {
        text: `Pendiente de alta para ${ev}`,
        detail: c.otherEmailMasked ? `En ese curso figura alguien con su nombre como ${c.otherEmailMasked}` : "En ese curso figura alguien con su nombre y otro mail",
        tone: "warn",
        Icon: AtSign,
      };
    case "awaiting_approval":
      return { text: `Pendiente de alta para ${ev}`, detail: "Falta aprobar el pago", tone: "idle", Icon: KeyRound };
    case "pending":
      return { text: `Pendiente de alta para ${ev}`, detail: "Pago aprobado, todavía sin acceso al curso", tone: "warn", Icon: KeyRound };
    case "not_found":
      return { text: `Pendiente de alta para ${ev}`, detail: "El alta automática frenó: el mail no figura en Tiendup", tone: "bad", Icon: MailX };
    case "queued":
      return { text: "En cola de reintento: Tiendup no respondió", detail: `${ev}. Se reintenta solo cada minuto`, tone: "warn", Icon: Clock };
    case "error":
      return { text: `Error en el alta para ${ev}`, detail: c.error ?? null, tone: "bad", Icon: CircleAlert };
    case "no_mapping":
      return { text: `${ev}: sin curso de Tiendup asociado`, detail: "Este evento no tiene curso mapeado; el acceso no se da por Tiendup", tone: "idle", Icon: CloudOff };
    default:
      return { text: `No se pudo consultar el curso de ${ev}`, tone: "idle", Icon: CloudOff };
  }
}

/** ¿El bloque está en rojo? (sube arriba de todo en la ficha). */
export function tiendupHasRed(f: TiendupFetch): boolean {
  if (f.phase !== "done" || !f.data.show) return false;
  const d = f.data;
  if (d.current && accessLine(d.current).tone === "bad") return true;
  return Boolean(d.mail && mailLine(d.mail).tone === "bad");
}

function LiveLineItem({ line, label }: { line: LiveLine; label: string }) {
  return (
    <li className="flex items-start gap-2">
      <line.Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${TONE_TEXT[line.tone]}`} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</p>
        <p className={`text-[12px] font-medium leading-snug ${TONE_TEXT[line.tone]}`}>{line.text}</p>
        {line.detail && (
          <p
            title={line.detail}
            className="mt-0.5 line-clamp-3 break-words text-[11.5px] leading-snug text-neutral-500 dark:text-neutral-400"
          >
            {line.detail}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Bloque "Tiendup" destacado: estado en vivo por curso. No rendea nada si no
 * corresponde (`show: false`) o todavía no se pidió.
 */
export function TiendupLiveBlock({
  fetchState,
  email,
  editor,
}: {
  fetchState: TiendupFetch;
  /** Correo consultado (línea al pie). null = no se muestra. */
  email: string | null;
  /** Campo de mail editable + "Enviar a Tiendup" debajo de "Esta inscripción". */
  editor?: { conversationId: string; email: string | null; onChanged: () => void };
}) {
  if (fetchState.phase === "idle") return null;
  if (fetchState.phase === "done" && !fetchState.data.show) return null;
  const red = tiendupHasRed(fetchState);
  const mail = fetchState.phase === "done" ? fetchState.data.mail ?? null : null;
  const current = fetchState.phase === "done" ? fetchState.data.current ?? null : null;
  return (
    <div
      className={`rounded-xl border p-3 ${
        red
          ? "border-red-500/50 shadow-[0_0_0_3px_rgba(239,68,68,0.08)] dark:border-red-500/40"
          : "border-gold/40 dark:border-gold/30"
      } bg-white dark:bg-neutral-950`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <KeyRound
          className={`h-3.5 w-3.5 ${red ? "text-red-600 dark:text-red-400" : "text-gold-fg dark:text-gold"}`}
          strokeWidth={1.75}
        />
        <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">Tiendup</span>
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          en vivo
        </span>
      </div>
      {fetchState.phase === "loading" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} /> Consultando Tiendup…
        </p>
      ) : fetchState.phase === "failed" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
          <CloudOff className="h-3.5 w-3.5" strokeWidth={1.75} /> No se pudo consultar Tiendup
        </p>
      ) : (
        <>
          <ul className="space-y-2.5">
            {mail && <LiveLineItem label="Mail" line={mailLine(mail)} />}
            {current && <LiveLineItem label="Esta inscripción" line={accessLine(current)} />}
          </ul>
          {editor && fetchState.phase === "done" && (
            <TiendupEmailEditor
              key={editor.conversationId}
              conversationId={editor.conversationId}
              email={editor.email}
              canEnroll={Boolean(fetchState.data.canEnroll)}
              mode={tiendupEditorMode({
                mailState: mail?.state,
                accessState: current?.state,
                savedEmail: editor.email,
              })}
              onChanged={editor.onChanged}
            />
          )}
        </>
      )}
      {email && !editor && (
        <p className="mt-2 truncate text-[11px] text-neutral-400 dark:text-neutral-500" title={email}>
          Correo consultado: {email}
        </p>
      )}
    </div>
  );
}
