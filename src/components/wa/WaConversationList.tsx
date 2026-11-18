"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  ClipboardCheck,
  Flag,
  Hand,
  Loader2,
  MessagesSquare,
  Paperclip,
  SearchX,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { CriticalPill } from "../CriticalPill";
import { clientEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatPhone } from "@/lib/search";
import { Avatar } from "../Avatar";
import { SearchField } from "../SearchField";
import type {
  WaConversationItem,
  WaConversationsResponse,
} from "@/app/api/wa/conversations/route";

// Lista del chat de WhatsApp: buscador, filtros y carga por páginas.
// La data sale de /api/wa/conversations (ver ahí por qué no se consulta
// directo desde el navegador). Se mantiene al día por Realtime, con un
// respaldo: si el canal se cae, se recrea, y al volver a la pestaña se
// refresca igual.

type Filter = "all" | "intervencion" | "aprobar" | "criticos" | "humano";

const PAGE = 40;

const FILTERS: {
  key: Filter;
  label: string;
  title: string;
  Icon?: typeof Hand;
  /** Color del botón cuando tiene algo pendiente (ámbar por defecto). */
  tone?: "warn" | "red";
}[] = [
  { key: "all", label: "Todas", title: "Todas las conversaciones" },
  // Conversaciones con notificaciones al equipo sin resolver (derivaciones,
  // reclamos, altas de Tiendup pendientes, comprobantes sin revisar, la
  // contacta que escribió con la IA en pausa). Mismo criterio que
  // src/lib/interventions.ts. Botón con la mano, como "Pendientes" de Hábitat.
  {
    key: "intervencion",
    label: "Derivadas",
    title: "Conversaciones que necesitan intervención del equipo",
    Icon: Hand,
  },
  // Comprobante pendiente o título sin revisar: mismo criterio que /revision.
  {
    key: "aprobar",
    label: "Falta aprobar",
    title: "Con un comprobante o un título esperando aprobación",
    Icon: ClipboardCheck,
  },
  // Tag "Crítico" del clasificador (src/lib/critical/).
  {
    key: "criticos",
    label: "Críticos",
    title: "Conversaciones marcadas como críticas (enojo, reclamo, amenaza)",
    Icon: TriangleAlert,
    tone: "red",
  },
  { key: "humano", label: "Con el equipo", title: "Conversaciones en modo Humano" },
];

/** Hora si es de hoy, "Ayer", día de la semana si es de esta semana, o fecha. */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) {
    return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (days === 1) return "Ayer";
  if (days < 7) return d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function previewLabel(item: WaConversationItem): { prefix: string; text: string } {
  const p = item.preview;
  if (!p) return { prefix: "", text: "Sin mensajes" };
  const text = p.text || (p.hasAttachment ? "Archivo adjunto" : "Mensaje sin texto");
  if (p.role === "assistant") return { prefix: "Valentina: ", text };
  if (p.role === "human") return { prefix: "Equipo: ", text };
  return { prefix: "", text };
}

export function WaConversationList({
  selectedId,
  onSelect,
  open,
  onClose,
  renamed,
  modeChanged,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Drawer en mobile. */
  open: boolean;
  onClose: () => void;
  /** Cambios hechos desde el panel de chat, para reflejarlos sin esperar. */
  renamed?: { id: string; name: string } | null;
  modeChanged?: { id: string; mode: "AI" | "HUMAN" } | null;
}) {
  const [items, setItems] = useState<WaConversationItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<WaConversationsResponse["counts"]>({
    all: 0,
    intervencion: 0,
    aprobar: 0,
    criticos: 0,
    humano: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Cuántas filas hay cargadas: al refrescar por Realtime se vuelve a pedir
  // la misma cantidad, para no perder el scroll de quien ya bajó.
  const loadedRef = useRef(PAGE);
  // Descarta respuestas viejas si el usuario siguió escribiendo.
  const requestRef = useRef(0);
  // Hay una búsqueda o filtro nuevo en camino: las actualizaciones en vivo
  // esperan, para no pisarla ni mezclar sus filas con las de la lista anterior.
  const resetInFlight = useRef(false);
  const resetSeq = useRef(0);
  const [rtNonce, setRtNonce] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (mode: "reset" | "refresh" | "more") => {
      if (mode === "refresh" && resetInFlight.current) return;
      const seq = mode === "reset" ? ++resetSeq.current : 0;
      if (mode === "reset") resetInFlight.current = true;
      const requestId = ++requestRef.current;
      const filtering = Boolean(debouncedQuery) || filter !== "all";
      const offset = mode === "more" ? loadedRef.current : 0;
      const limit = mode === "refresh" ? Math.min(Math.max(loadedRef.current, PAGE), 300) : PAGE;
      const params = new URLSearchParams({
        filter,
        offset: String(offset),
        limit: String(limit),
      });
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (mode === "more") setLoadingMore(true);
      if (mode === "reset") setSearching(true);
      try {
        const r = await fetch(`/api/wa/conversations?${params}`, { cache: "no-store" });
        const j = (await r.json()) as WaConversationsResponse & { error?: string };
        if (requestId !== requestRef.current) return;
        if (!r.ok) {
          setError(j.error ?? "No se pudieron cargar las conversaciones");
          return;
        }
        setError(null);
        setTotal(j.total);
        setHasMore(j.hasMore);
        setCounts(j.counts);
        setLoaded(true);
        if (mode === "more") {
          setItems((prev) => {
            const seen = new Set((prev ?? []).map((i) => i.id));
            return [...(prev ?? []), ...j.items.filter((i) => !seen.has(i.id))];
          });
          loadedRef.current = offset + j.items.length;
        } else if (mode === "refresh") {
          // Actualiza el tramo de arriba (donde cae la actividad nueva) y
          // conserva lo que ya estaba cargado más abajo. Reemplazar todo
          // recortaba la lista y hacía saltar a quien había bajado mucho.
          setItems((prev) => {
            // Con búsqueda o filtro, una fila puede SALIR de la lista (se
            // atendió la derivación, se devolvió a Valentina): manda lo que
            // dice el servidor. Sin filtro nada sale, solo cambia el orden,
            // así que se conserva todo lo cargado que no vino en el tramo nuevo.
            if (filtering) return j.items;
            const fresh = new Set(j.items.map((i) => i.id));
            const rest = (prev ?? []).filter((i) => !fresh.has(i.id));
            const next = [...j.items, ...rest];
            loadedRef.current = Math.max(next.length, PAGE);
            return next;
          });
          if (filtering) loadedRef.current = Math.max(j.items.length, PAGE);
        } else {
          setItems(j.items);
          loadedRef.current = Math.max(j.items.length, PAGE);
          // Búsqueda o filtro nuevo: los resultados se leen desde el primero.
          if (listRef.current) listRef.current.scrollTop = 0;
        }
      } catch {
        if (requestId === requestRef.current) setError("Error de red");
      } finally {
        if (mode === "reset" && seq === resetSeq.current) resetInFlight.current = false;
        if (requestId === requestRef.current) {
          setLoadingMore(false);
          setSearching(false);
        }
      }
    },
    [debouncedQuery, filter],
  );

  // Búsqueda o filtro nuevo: arrancar de cero.
  useEffect(() => {
    loadedRef.current = PAGE;
    void load("reset");
  }, [load]);

  // Realtime: un mensaje nuevo, un cambio de modo o una derivación refrescan
  // la lista. Se agrupan los eventos (un turno del agente dispara varios).
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    let hadSubscribed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (active) void loadRef.current("refresh");
      }, 800);
    };
    const slug = clientEnv.NEXT_PUBLIC_CLIENT_SLUG;
    const channel = supabase
      .channel(`wa-list-${rtNonce}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `client_slug=eq.${slug}` },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_notifications" }, refresh)
      // Un comprobante revisado cambia quién necesita intervención.
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_validations" }, refresh)
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          // Volvió después de una caída: ponerse al día con lo que pasó.
          if (hadSubscribed) refresh();
          hadSubscribed = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (retry) clearTimeout(retry);
          retry = setTimeout(() => active && setRtNonce((n) => n + 1), 3000);
        }
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("atp:notifications-changed", refresh);
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      if (pending) clearTimeout(pending);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("atp:notifications-changed", refresh);
      void supabase.removeChannel(channel);
    };
  }, [rtNonce]);

  useEffect(() => {
    if (!renamed) return;
    setItems((prev) =>
      prev ? prev.map((c) => (c.id === renamed.id ? { ...c, displayName: renamed.name } : c)) : prev,
    );
  }, [renamed]);

  useEffect(() => {
    if (!modeChanged) return;
    setItems((prev) =>
      prev ? prev.map((c) => (c.id === modeChanged.id ? { ...c, mode: modeChanged.mode } : c)) : prev,
    );
  }, [modeChanged]);

  // Carga la página siguiente cuando el final de la lista entra en pantalla.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loadingMore) void load("more");
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, load, items]);

  const isFiltering = Boolean(debouncedQuery) || filter !== "all";

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[55] bg-neutral-900/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-[60] flex h-full w-[340px] max-w-[88vw] shrink-0 flex-col border-r border-neutral-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 dark:border-neutral-800 dark:bg-neutral-950 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 pb-2 pt-4">
          <div className="flex items-baseline gap-2.5 px-1">
            <h2 className="text-[13px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
              WhatsApp
            </h2>
            <span className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
              {!loaded ? "" : isFiltering ? `${total} de ${counts.all}` : counts.all}
            </span>
            {searching && items !== null && (
              <Loader2
                className="ml-auto h-3 w-3 animate-spin text-neutral-400 dark:text-neutral-500"
                strokeWidth={1.75}
              />
            )}
          </div>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nombre o teléfono"
            className="mt-3"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => {
              const count = f.key === "all" ? null : counts[f.key];
              const activeFilter = filter === f.key;
              // Look de Hábitat: los botones con ícono se marcan en ámbar
              // cuando tienen algo pendiente, aunque no estén activos.
              const flagged = Boolean(f.Icon) && (count ?? 0) > 0;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={activeFilter}
                  title={f.title}
                  className={`flex min-h-[30px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition ${
                    f.Icon ? "border font-medium" : ""
                  } ${
                    activeFilter
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-950"
                      : flagged && f.tone === "red"
                        ? "border-red-600/40 bg-white text-red-700 hover:bg-neutral-50 dark:border-red-400/50 dark:bg-neutral-950 dark:text-red-400 dark:hover:bg-neutral-900"
                        : flagged
                        ? "border-amber-700/40 bg-white text-warn-fg hover:bg-neutral-50 dark:border-amber-500/50 dark:bg-neutral-950 dark:text-warn dark:hover:bg-neutral-900"
                        : f.Icon
                          ? "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900"
                          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }`}
                >
                  {f.Icon && <f.Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  {f.label}
                  {count !== null && (count > 0 || (Boolean(f.Icon) && loaded)) && (
                    <span
                      className={`min-w-3 text-center font-mono text-[10.5px] tabular-nums ${
                        activeFilter ? "opacity-70" : flagged ? "" : "text-neutral-400 dark:text-neutral-500"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div
          ref={listRef}
          aria-busy={searching}
          className={`scroll-thin flex-1 overflow-y-auto px-2 pb-3 transition-opacity ${
            // Mientras llega la búsqueda nueva, lo que se ve es de la anterior.
            searching && items !== null ? "opacity-40" : ""
          }`}
        >
          {items === null ? (
            error ? (
              <div className="px-4 py-16 text-center">
                <p className="text-[13px] text-neutral-600 dark:text-neutral-400">{error}</p>
                <button
                  onClick={() => void load("reset")}
                  className="mt-3 rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <ul className="space-y-px" aria-hidden>
                {Array.from({ length: 9 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-neutral-100 dark:bg-neutral-900" />
                    <div className="flex-1 space-y-2">
                      <div className="h-2.5 w-2/5 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
                      <div className="h-2.5 w-4/5 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-400 dark:border-neutral-800 dark:text-neutral-600">
                {isFiltering ? (
                  <SearchX className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <MessagesSquare className="h-4 w-4" strokeWidth={1.5} />
                )}
              </div>
              <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-200">
                {debouncedQuery
                  ? "Sin resultados"
                  : filter === "intervencion"
                    ? "Ninguna necesita intervención"
                    : filter === "aprobar"
                      ? "Nada esperando aprobación"
                      : filter === "criticos"
                        ? "Ninguna conversación crítica"
                    : filter === "humano"
                      ? "Ninguna conversación con el equipo"
                      : "Sin conversaciones de WhatsApp todavía"}
              </p>
              {debouncedQuery && (
                <p className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                  Nadie coincide con “{debouncedQuery}”. Probá con otra parte del nombre o del número
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-px">
              {items.map((c) => {
                const selected = selectedId === c.id;
                const { prefix, text } = previewLabel(c);
                const when = c.preview?.at ?? c.updatedAt;
                // La clienta escribió última: nadie le contestó todavía.
                const waiting = c.preview?.role === "user";
                return (
                  <li key={c.id} className="relative">
                    <button
                      onClick={() => onSelect(c.id)}
                      aria-current={selected ? "true" : undefined}
                      className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                        selected
                          ? "bg-neutral-100 dark:bg-neutral-900"
                          : "hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                      }`}
                    >
                      {/* Línea al costado, como en Hábitat: ámbar si necesita
                          intervención (gana sobre la de selección), dorada si
                          está seleccionada. */}
                      {(c.needsTeam || selected) && (
                        <span
                          aria-hidden
                          data-attention-line={c.needsTeam || undefined}
                          className={`absolute inset-y-1.5 left-0 rounded-full ${
                            c.needsTeam ? "w-0.5 bg-warn-fg dark:bg-warn" : "w-0.5 bg-gold"
                          }`}
                        />
                      )}
                      <span className="relative shrink-0">
                        <Avatar name={c.displayName} size="md" />
                        <span
                          title={c.mode === "HUMAN" ? "La atiende el equipo" : "La atiende Valentina"}
                          className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-white dark:border-neutral-950 ${
                            c.mode === "HUMAN"
                              ? "bg-warn text-black"
                              : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          }`}
                        >
                          {c.mode === "HUMAN" ? (
                            <UserRound className="h-2.5 w-2.5" strokeWidth={2} />
                          ) : (
                            <Bot className="h-2.5 w-2.5" strokeWidth={2} />
                          )}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span
                            className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100"
                          >
                            {c.displayName}
                          </span>
                          {c.critical && <CriticalPill compact reason={c.criticalReason} />}
                          <span className="ml-auto shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                            {shortWhen(when)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          {c.preview?.hasAttachment && (
                            <Paperclip
                              className="h-3 w-3 shrink-0 text-neutral-400 dark:text-neutral-500"
                              strokeWidth={1.75}
                            />
                          )}
                          <span
                            className={`min-w-0 flex-1 truncate text-[12px] ${
                              waiting
                                ? "text-neutral-800 dark:text-neutral-200"
                                : "text-neutral-500 dark:text-neutral-500"
                            }`}
                          >
                            {prefix && <span className="text-neutral-400 dark:text-neutral-500">{prefix}</span>}
                            {text}
                          </span>
                          {c.pendingApproval && (
                            <span title="Tiene algo esperando aprobación" className="shrink-0 text-neutral-400 dark:text-neutral-500">
                              <ClipboardCheck className="h-3 w-3" strokeWidth={1.75} />
                            </span>
                          )}
                          {c.needsTeam && (
                            <span title="Necesita intervención del equipo" className="shrink-0 text-warn">
                              <Flag className="h-3 w-3" strokeWidth={2} />
                            </span>
                          )}
                          {waiting && !c.needsTeam && (
                            <span
                              title="El último mensaje es de la clienta"
                              className="h-2 w-2 shrink-0 rounded-full bg-gold"
                            />
                          )}
                        </span>
                        {debouncedQuery && c.phone && (
                          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-neutral-400 dark:text-neutral-500">
                            {formatPhone(c.phone)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {hasMore && (
                <li>
                  <div
                    ref={sentinelRef}
                    className="flex items-center justify-center gap-2 py-4 text-[12px] text-neutral-400 dark:text-neutral-500"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                    Cargando más
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
