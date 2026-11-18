"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessagesSquare, MousePointerClick } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { clientEnv } from "@/lib/env";
import type { PaymentItem, TitleReview } from "@/app/api/payments/route";
import { CommentsPanel } from "../CommentsPanel";
import type { CommentTarget } from "../ConversationPanel";
import { WaChatPanel } from "../wa/WaChatPanel";
import { useContactSearch } from "../useContactSearch";
import { ReviewQueue } from "./ReviewQueue";
import { ReviewDetail } from "./ReviewDetail";
import { buildReviewItems, type ReviewItem } from "./review-items";

// /revision: cola de pendientes + chat + archivo y ficha, en una pantalla.
//
// - La cola sale de GET /api/payments (lo mismo que Aprobaciones), con
//   ?with=interventions para el indicador de derivaciones abiertas.
// - Aprobar / rechazar usa las mismas PATCH que Aprobaciones; después se
//   recarga la lista y se pasa solo al siguiente pendiente.
// - Realtime sobre payment_validations, professional_titles y
//   agent_notifications con filtro client_slug (como /wa).
// - Desktop (lg+): 3 columnas. Mobile: pestañas Pendientes / Chat / Archivo.

type MobileTab = "lista" | "chat" | "detalle";

const LG_QUERY = "(min-width: 1024px)";

const columnCls =
  "min-h-0 overflow-hidden border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 lg:rounded-xl lg:border";

export function ReviewWorkspace() {
  const searchParams = useSearchParams();
  const urlId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(urlId);

  const { query, setQuery, activeQuery } = useContactSearch(300);
  const searchQuery = activeQuery.length >= 2 ? activeQuery : "";

  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [interventions, setInterventions] = useState<Record<string, number>>({});
  const [critical, setCritical] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  // Sube con cada recarga: la ficha de la derecha se vuelve a pedir.
  const [refreshKey, setRefreshKey] = useState(0);

  const [tab, setTab] = useState<MobileTab>(urlId ? "detalle" : "lista");
  const [detailOpen, setDetailOpen] = useState(true);
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);

  const requestRef = useRef(0);
  const searchRef = useRef(searchQuery);
  searchRef.current = searchQuery;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  // Orden de la cola anterior: si el seleccionado desaparece (se resolvió acá
  // o desde otra pantalla), se pasa al que le seguía.
  const orderRef = useRef<string[]>([]);

  const writeUrl = useCallback((id: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("id", id);
    else params.delete("id");
    const qs = params.toString();
    // Solo la URL, sin ida y vuelta al servidor (igual que /wa).
    window.history.replaceState(null, "", qs ? `/revision?${qs}` : "/revision");
  }, []);

  const select = useCallback(
    (id: string | null, opts: { openDetail?: boolean } = {}) => {
      setSelectedId(id);
      setCommentTarget(null);
      writeUrl(id);
      if (id && opts.openDetail) setTab("detalle");
    },
    [writeUrl],
  );

  const load = useCallback(
    async (q: string) => {
      const requestId = ++requestRef.current;
      try {
        const params = new URLSearchParams(q ? { q } : { status: "pending" });
        params.set("with", "interventions");
        const r = await fetch(`/api/payments?${params}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (requestId !== requestRef.current) return;
        if (!r.ok) {
          setError(j.error ?? "No se pudieron cargar los pendientes");
          return;
        }
        const next = buildReviewItems(
          (j.items as PaymentItem[]) ?? [],
          (j.titleReviews as TitleReview[]) ?? [],
        );
        setError(null);
        setItems(next);
        setInterventions((j.interventions as Record<string, number>) ?? {});
        setCritical((j.critical as Record<string, string | null>) ?? {});
        setRefreshKey((k) => k + 1);

        // Selección: se mantiene si sigue en la cola; si no, el siguiente de
        // la cola anterior que siga pendiente; si no, el primero.
        const current = selectedRef.current;
        const ids = new Set(next.map((it) => it.id));
        if (!current || !ids.has(current)) {
          const prev = orderRef.current;
          const from = current ? prev.indexOf(current) : -1;
          const after = from >= 0 ? prev.slice(from + 1).find((id) => ids.has(id)) : undefined;
          const before =
            from >= 0 ? prev.slice(0, from).reverse().find((id) => ids.has(id)) : undefined;
          const pick = after ?? before ?? next[0]?.id ?? null;
          // Con un ?id= que ya no está pendiente y la cola vacía, se limpia.
          if (pick !== current) select(pick);
        }
        orderRef.current = next.map((it) => it.id);
      } catch {
        if (requestId === requestRef.current) setError("Error de red");
      }
    },
    [select],
  );

  useEffect(() => {
    void load(searchQuery);
  }, [searchQuery, load]);

  // Realtime: cualquier cambio en comprobantes, títulos o derivaciones de este
  // cliente recarga la cola (con una pequeña espera para agrupar ráfagas).
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const filter = `client_slug=eq.${clientEnv.NEXT_PUBLIC_CLIENT_SLUG}`;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void load(searchRef.current);
      }, 800);
    };
    const channel = supabase
      .channel("revision-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_validations", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "professional_titles", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_notifications", filter }, refresh)
      .subscribe();
    return () => {
      if (pending) clearTimeout(pending);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const selected = items?.find((it) => it.id === selectedId) ?? null;
  const convId = selected?.conversationId ?? null;

  const toggleDetail = useCallback(() => {
    if (commentTarget) {
      setCommentTarget(null);
      setDetailOpen(true);
      return;
    }
    if (window.matchMedia(LG_QUERY).matches) setDetailOpen((v) => !v);
    else setTab("detalle");
  }, [commentTarget]);

  const TABS: { key: MobileTab; label: string }[] = [
    { key: "lista", label: items ? `Pendientes · ${items.length}` : "Pendientes" },
    { key: "chat", label: "Chat" },
    { key: "detalle", label: "Archivo" },
  ];

  return (
    <div className="flex h-full flex-col bg-white lg:bg-neutral-50 dark:bg-neutral-950 lg:dark:bg-neutral-950">
      {/* Mobile / tablet: pestañas */}
      <div className="flex shrink-0 border-b border-neutral-200 px-2 lg:hidden dark:border-neutral-800">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative px-3 py-2.5 text-[13px] transition ${
                active
                  ? "text-neutral-900 dark:text-neutral-50"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              {t.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-gold to-gold-start"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 lg:gap-3 lg:p-3">
        {/* 1. Cola */}
        <section
          aria-label="Pendientes"
          className={`${columnCls} w-full flex-col lg:flex lg:w-[300px] lg:shrink-0 xl:w-[320px] ${
            tab === "lista" ? "flex" : "hidden"
          }`}
        >
          <ReviewQueue
            items={items}
            error={error}
            query={query}
            onQueryChange={setQuery}
            searching={Boolean(searchQuery)}
            selectedId={selectedId}
            onSelect={(id) => select(id, { openDetail: true })}
            interventions={interventions}
            critical={critical}
            onRetry={() => void load(searchQuery)}
          />
        </section>

        {/* 2. Chat */}
        <section
          aria-label="Conversación"
          className={`${columnCls} min-w-0 flex-1 flex-col lg:flex ${tab === "chat" ? "flex" : "hidden"}`}
        >
          {convId ? (
            <WaChatPanel
              key={convId}
              conversationId={convId}
              onOpenSidebar={() => setTab("lista")}
              onOpenComments={(target) => setCommentTarget(target)}
              fichaOpen={detailOpen && !commentTarget}
              onToggleFicha={toggleDetail}
            />
          ) : (
            <EmptyColumn
              icon={MessagesSquare}
              title={selected ? "Sin conversación asociada" : "Elegí un pendiente"}
              text={selected ? "Este archivo no está ligado a un chat de WhatsApp" : "La conversación aparece acá"}
            />
          )}
        </section>

        {/* 3. Archivo, intervención y acceso */}
        {commentTarget ? (
          <CommentsPanel target={commentTarget} onClose={() => setCommentTarget(null)} />
        ) : (
          <section
            aria-label="Archivo y ficha"
            className={`${columnCls} w-full flex-col lg:w-[380px] lg:shrink-0 xl:w-[420px] ${
              tab === "detalle" ? "flex" : "hidden"
            } ${detailOpen ? "lg:flex" : "lg:hidden"}`}
          >
            {selected ? (
              <ReviewDetail
                item={selected}
                refreshKey={refreshKey}
                onDone={() => void load(searchRef.current)}
              />
            ) : (
              <EmptyColumn
                icon={MousePointerClick}
                title={items && items.length === 0 ? "No hay aprobaciones pendientes" : "Elegí un pendiente"}
                text={
                  items && items.length === 0
                    ? "Cuando entre un comprobante o un título aparece acá"
                    : "El archivo y la ficha aparecen acá"
                }
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function EmptyColumn({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof MessagesSquare;
  title: string;
  text: string;
}) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className="h-7 w-7 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
      <div>
        <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-50">{title}</p>
        <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-500">{text}</p>
      </div>
    </div>
  );
}
