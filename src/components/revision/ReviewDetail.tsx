"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Flag, KeyRound, Loader2, Mail, MessageCircle } from "lucide-react";
import { FileReviewPanel, type FileReviewAction } from "../wa/FileReviewModal";
import type { ContactEvent, ContactFicha } from "@/app/api/wa/contact/[conversationId]/route";
import { fmtAge, type ReviewItem } from "./review-items";

// Columna derecha de /revision:
//   1. El archivo con Aprobar / Rechazar (FileReviewPanel, mismas rutas PATCH
//      que Aprobaciones y la ficha de /wa).
//   2. Derivaciones abiertas de la conversación.
//   3. Estado del acceso a Tiendup y correo capturado.
// 2 y 3 salen de la ficha del contacto de /wa (GET /api/wa/contact/[id]), sin
// endpoints nuevos.

const CATEGORY_LABELS: Record<string, string> = {
  fuera_de_conocimiento: "Fuera de conocimiento",
  escalado_manual: "Escalado manual",
  reclamo_certificado: "Reclamo de certificado",
  cliente_existente: "Cliente existente",
  interes_compra: "Interés de compra",
  falla_tecnica: "Falla técnica",
};

type Tone = "ok" | "warn" | "bad" | "idle";

function Dot({ tone }: { tone: Tone }) {
  const cls =
    tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-red-500" : "bg-neutral-300 dark:bg-neutral-700";
  return <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

function accessLine(ev: ContactEvent): { text: string; tone: Tone; detail: string | null } {
  const a = ev.access;
  switch (a.stage) {
    case "granted":
      return { text: `Acceso dado el ${fmtDate(a.grantedAt)}`, tone: "ok", detail: null };
    case "missing":
      return a.error
        ? { text: "Alta pendiente", tone: "warn", detail: a.error }
        : { text: "Falta dar el acceso", tone: "warn", detail: null };
    case "missing_email":
      return { text: "Sin correo, falta pedírselo", tone: "warn", detail: a.error };
    case "closed":
      return { text: "El curso ya cerró", tone: "idle", detail: null };
    case "waiting_payment":
      return {
        text: ev.payment.stage === "rejected" ? "Pago rechazado, sin acceso" : "Pendiente, después de aprobar el pago",
        tone: "idle",
        detail: null,
      };
    default:
      return { text: "No aplica", tone: "idle", detail: null };
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 px-4 py-4 dark:border-neutral-800">
      <h3 className="mb-2.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

const linkCls =
  "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50";

export function ReviewDetail({
  item,
  refreshKey,
  onDone,
}: {
  item: ReviewItem;
  /** Cambia cuando la lista se recarga: la ficha se vuelve a pedir. */
  refreshKey: number;
  onDone: (action: FileReviewAction) => void;
}) {
  const convId = item.conversationId;
  const [ficha, setFicha] = useState<ContactFicha | null>(null);
  const [fichaError, setFichaError] = useState<string | null>(null);
  // Descarta respuestas de una persona anterior (cambio rápido de ítem).
  const convRef = useRef(convId);
  convRef.current = convId;

  const loadFicha = useCallback(async () => {
    if (!convId) return;
    try {
      const r = await fetch(`/api/wa/contact/${convId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (convRef.current !== convId) return;
      if (!r.ok) {
        setFichaError(r.status === 404 ? "No se encontró la conversación" : j.error ?? "No se pudo cargar la ficha");
        return;
      }
      setFichaError(null);
      setFicha(j as ContactFicha);
    } catch {
      if (convRef.current === convId) setFichaError("Error de red");
    }
  }, [convId]);

  // Al cambiar de persona se limpia; al recargar la lista se refresca en el lugar.
  useEffect(() => {
    setFicha(null);
    setFichaError(null);
  }, [convId]);
  useEffect(() => {
    void loadFicha();
  }, [loadFicha, refreshKey]);

  const p = item.payment;
  const warnings = p
    ? [
        p.isDuplicate ? "El N° de operación ya está en otro comprobante" : null,
        p.contactHasValidatedPayment ? "Ya tiene otro pago aprobado" : null,
      ].filter((w): w is string => Boolean(w))
    : [];

  const open = ficha
    ? [
        ...ficha.derivaciones.filter((d) => !d.resolvedAt),
        ...ficha.certificados
          .filter((c) => !c.resolvedAt)
          .map((c) => ({ ...c, category: "reclamo_certificado" })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const accessEvents = ficha
    ? ficha.events.filter((e) => e.kind === "masterclass" && e.payment.stage !== "none")
    : [];

  return (
    <div className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex shrink-0 flex-col p-4">
        <FileReviewPanel key={item.id} file={item.file} variant="inline" onDone={onDone} />
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {warnings.map((w) => (
              <li key={w} className="flex items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
                <AlertTriangle className="h-3 w-3 shrink-0 text-warn" strokeWidth={2} />
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!convId ? (
        <Section title="Contacto">
          <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
            Este archivo no tiene una conversación asociada
          </p>
        </Section>
      ) : !ficha ? (
        <Section title="Contacto">
          {fichaError ? (
            <p className="text-[12px] text-neutral-500">
              {fichaError}{" "}
              <button onClick={() => void loadFicha()} className="underline underline-offset-2">
                Reintentar
              </button>
            </p>
          ) : (
            <p className="flex items-center gap-2 text-[12px] text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> Cargando ficha…
            </p>
          )}
        </Section>
      ) : (
        <>
          <Section title="Intervención">
            {open.length === 0 ? (
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                Sin derivaciones abiertas
              </p>
            ) : (
              <ul className="space-y-2.5">
                {open.slice(0, 4).map((n) => (
                  <li key={n.id} className="flex items-start gap-2.5">
                    <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100">
                          {CATEGORY_LABELS[n.category] ?? n.category}
                        </p>
                        <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                          {fmtAge(n.createdAt)}
                        </span>
                      </div>
                      {n.summary && (
                        <p
                          title={n.summary}
                          className="mt-0.5 line-clamp-3 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400"
                        >
                          {n.summary}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
                {open.length > 4 && (
                  <li className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                    Y {open.length - 4} más
                  </li>
                )}
              </ul>
            )}
            <div className="mt-2.5 flex flex-wrap gap-1">
              <Link href={`/wa?id=${convId}`} className={linkCls}>
                <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                Abrir en WhatsApp
              </Link>
              {open.length > 0 && (
                <Link href="/interventions" className={linkCls}>
                  Ir a Derivaciones
                  <ArrowRight className="h-3 w-3" strokeWidth={2} />
                </Link>
              )}
            </div>
          </Section>

          <Section title="Acceso a Tiendup">
            <div className="flex items-center gap-2 text-[12px] text-neutral-700 dark:text-neutral-200">
              <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
              {ficha.conversation.email ? (
                <span className="min-w-0 truncate">{ficha.conversation.email}</span>
              ) : (
                <span className="text-neutral-400 dark:text-neutral-500">Todavía no dejó su correo</span>
              )}
            </div>
            {accessEvents.length === 0 ? (
              <p className="mt-2.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                Sin pagos de masterclass
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {accessEvents.map((ev) => {
                  const line = accessLine(ev);
                  return (
                    <li key={ev.key} className="flex items-start gap-2.5">
                      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium leading-snug text-neutral-800 dark:text-neutral-100">
                          {ev.title}
                        </p>
                        <span className="mt-0.5 flex items-start gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                          <Dot tone={line.tone} />
                          {line.text}
                        </span>
                        {line.detail && (
                          <p
                            title={line.detail}
                            className="mt-0.5 line-clamp-2 pl-3 text-[11px] text-neutral-500 dark:text-neutral-500"
                          >
                            {line.detail}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link href="/payments?filter=sin-acceso" className={`${linkCls} mt-2.5 w-fit`}>
              Aprobaciones · Falta acceso
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          </Section>
        </>
      )}
    </div>
  );
}
