"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Receipt,
  FileText,
  Check,
  X,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useProfile } from "./ProfileProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PaymentItem } from "@/app/api/payments/route";

// Sección de validación de comprobantes de pago. Lista todos los comprobantes
// capturados por el agente (datos leídos con vision), ordenados por fecha. El
// equipo revisa cada uno contra su contabilidad y lo marca aprobado o
// rechazado para habilitar (o no) el acceso al curso.

type StatusFilter = "pending" | "validated" | "rejected" | "all";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Pendientes" },
  { key: "validated", label: "Validados" },
  { key: "rejected", label: "Rechazados" },
  { key: "all", label: "Todos" },
];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "Monto no leído";
  const n = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0 }).format(amount);
  return `${currency ?? "ARS"} ${n}`;
}

function statusBadge(status: PaymentItem["status"]): { label: string; cls: string } {
  if (status === "validated") {
    return {
      label: "Validado",
      cls: "border-ok/30 bg-ok/[0.06] text-ok",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rechazado",
      cls: "border-red-200/70 bg-red-50/60 text-red-700 dark:border-red-500/30 dark:bg-red-500/[0.06] dark:text-red-300",
    };
  }
  return {
    label: "Pendiente",
    cls: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400",
  };
}

/** Fila de dato: label mono + valor. No rendea si el valor está vacío. */
function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-neutral-800 dark:text-neutral-100">{value}</dd>
    </div>
  );
}

export function PaymentsList() {
  const router = useRouter();
  const { profile } = useProfile();
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<PaymentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async (status: StatusFilter) => {
    try {
      const r = await fetch(`/api/payments?status=${status}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron cargar los comprobantes");
        return;
      }
      setError(null);
      setItems(j.items as PaymentItem[]);
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    setItems(null);
    void load(filter);
  }, [filter, load]);

  // Realtime: refrescar cuando entra un comprobante nuevo o cambia un estado.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("payment-validations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_validations" },
        () => void load(filterRef.current),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function setStatus(id: string, status: "validated" | "rejected" | "pending") {
    setBusyId(id);
    try {
      const r = await fetch(`/api/payments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          note: notes[id]?.trim() || null,
          validatedBy: profile?.id ?? null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? "No se pudo actualizar el comprobante");
        return;
      }
      await load(filterRef.current);
    } catch {
      setError("Error de red al actualizar");
    } finally {
      setBusyId(null);
    }
  }

  if (error && items === null) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-500">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between pb-3">
        <h1 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          Comprobantes de pago
        </h1>
        {items && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {items.length} comprobante{items.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Filtros por estado */}
      <div className="mb-4 flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-2.5 py-1.5 text-[12px] transition ${
              filter === f.key
                ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-neutral-500 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          Cargando comprobantes…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Receipt className="h-6 w-6 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
            No hay comprobantes {filter !== "all" ? FILTERS.find((f) => f.key === filter)?.label.toLowerCase() : ""}
          </p>
          <p className="text-[12px] text-neutral-500 dark:text-neutral-500">
            Los comprobantes que manden las profesionales por WhatsApp aparecen acá.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => {
            const badge = statusBadge(p.status);
            const isPending = p.status === "pending";
            const busy = busyId === p.id;
            return (
              <article
                key={p.id}
                className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex flex-col gap-4 sm:flex-row">
                  {/* Comprobante */}
                  <div className="shrink-0">
                    {p.comprobanteUrl ? (
                      p.comprobanteType === "application/pdf" ? (
                        <a
                          href={p.comprobanteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-40 w-32 flex-col items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 text-[11.5px] text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        >
                          <FileText className="h-5 w-5" strokeWidth={1.5} />
                          Ver PDF
                        </a>
                      ) : (
                        <a href={p.comprobanteUrl} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.comprobanteUrl}
                            alt="Comprobante"
                            className="h-40 w-32 rounded-md border border-neutral-200 object-cover transition hover:opacity-90 dark:border-neutral-800"
                          />
                        </a>
                      )
                    ) : (
                      <div className="flex h-40 w-32 items-center justify-center rounded-md border border-dashed border-neutral-200 text-[11px] text-neutral-400 dark:border-neutral-800">
                        Sin imagen
                      </div>
                    )}
                  </div>

                  {/* Datos */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
                          {p.senderName ?? "Emisor no leído"}
                        </p>
                        <p className="mt-0.5 font-mono text-[15px] tracking-tight-er text-neutral-900 dark:text-neutral-50">
                          {fmtAmount(p.amount, p.currency)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md border px-2 py-0.5 text-[11.5px] tracking-tight-er ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                      <Field label="Fecha y hora" value={p.transferDateRaw} />
                      <Field label="Banco / medio" value={p.bankOrMethod} />
                      <Field label="N° de operación" value={p.operationNumber} />
                      <Field label="CUIT emisor" value={p.senderTaxId} />
                      <Field label="Destinatario" value={p.recipientName} />
                      <Field label="CUIT destinatario" value={p.recipientTaxId} />
                      <Field label="Concepto" value={p.concept} />
                      <Field label="Contacto" value={p.contactName} />
                      <Field label="Email" value={p.contactEmail} />
                      <Field label="Evento" value={p.eventSlug} />
                    </dl>

                    {/* Meta de la lectura + origen */}
                    <p className="mt-3 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                      Recibido {fmtDateTime(p.createdAt)}
                      {p.extractionConfidence ? ` · lectura ${p.extractionConfidence}` : ""}
                    </p>

                    {/* Estado resuelto */}
                    {!isPending && (
                      <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                        {badge.label} por {p.validatedByName ?? "el equipo"}
                        {p.validatedAt ? ` · ${fmtDateTime(p.validatedAt)}` : ""}
                        {p.validationNote ? ` · ${p.validationNote}` : ""}
                      </p>
                    )}
                  </div>
                </div>

                {/* Acciones */}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                  {p.conversation && (
                    <button
                      onClick={() =>
                        router.push(`/conversations?id=${p.conversation!.id}`)
                      }
                      className="mr-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      Ver conversación
                      <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  )}

                  {isPending ? (
                    <>
                      <input
                        value={notes[p.id] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [p.id]: e.target.value }))
                        }
                        placeholder="Nota (opcional)"
                        className="w-40 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600"
                      />
                      <button
                        onClick={() => void setStatus(p.id, "rejected")}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        ) : (
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        )}
                        Rechazar
                      </button>
                      <button
                        onClick={() => void setStatus(p.id, "validated")}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-50 dark:text-neutral-950 dark:hover:bg-neutral-200"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        ) : (
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        )}
                        Aprobar
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => void setStatus(p.id, "pending")}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                      Volver a pendiente
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
