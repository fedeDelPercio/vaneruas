"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, X, Plus, Maximize2, Minimize2 } from "lucide-react";
import { DateTimeField } from "./DateTimeField";
import { installmentAmount, formatARS } from "@/lib/events/format";
import type { EventItem as ApiEventItem } from "@/app/api/events/route";

// Modal de alta / edición de un evento (masterclass o congreso). Reusa el
// DateTimeField propio del repo (sin pickers nativos). Todos los campos
// opcionales pueden quedar vacíos: un evento se puede dejar en borrador con
// datos incompletos y completarlo después.

// --- helpers de conversión fecha local <-> ISO ----------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function nowLocalString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocal(iso: string | null): string {
  if (!iso) return nowLocalString();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return nowLocalString();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function numToInput(n: number | null): string {
  return n == null ? "" : String(n);
}

// --- subcomponentes de UI --------------------------------------------------

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50/60 p-0.5 dark:border-neutral-800 dark:bg-neutral-900/60">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[5px] px-3 py-1.5 text-[12.5px] font-medium transition ${
            value === o.value
              ? "bg-white text-neutral-900 shadow-soft dark:bg-neutral-800 dark:text-neutral-50"
              : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const fieldLabel =
  "block text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300";
const subLabel =
  "block text-[11px] font-medium text-neutral-500 dark:text-neutral-400";
const textInput =
  "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600";

type Kind = "masterclass" | "congress";
type Status = "borrador" | "activo" | "archivado";

export function EventFormModal({
  event,
  onClose,
  onSaved,
}: {
  event: ApiEventItem | null; // null = alta
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = event !== null;

  const [title, setTitle] = useState(event?.title ?? "");
  const [kind, setKind] = useState<Kind>((event?.kind as Kind) ?? "masterclass");
  const [status, setStatus] = useState<Status>((event?.status as Status) ?? "borrador");
  const [announceAt, setAnnounceAt] = useState(isoToLocal(event?.announceAt ?? null));
  const [eventAt, setEventAt] = useState(isoToLocal(event?.eventAt ?? null));
  const [hasEnd, setHasEnd] = useState(event?.eventEndAt != null);
  const [eventEndAt, setEventEndAt] = useState(isoToLocal(event?.eventEndAt ?? null));
  const [cardTotal, setCardTotal] = useState(numToInput(event?.cardTotal ?? null));
  const [cardInstallments, setCardInstallments] = useState(
    numToInput(event?.cardInstallments ?? null),
  );
  const [transferPrice, setTransferPrice] = useState(
    numToInput(event?.transferPrice ?? null),
  );
  const [internationalPrice, setInternationalPrice] = useState(
    numToInput(event?.internationalPrice ?? null),
  );
  const [details, setDetails] = useState(event?.details ?? "");
  const [landingUrl, setLandingUrl] = useState(event?.landingUrl ?? "");
  const [kbZoom, setKbZoom] = useState(false);
  const [saving, setSaving] = useState(false);

  // ESC cierra (salvo guardando, o si está abierto el zoom de la KB).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || saving) return;
      if (kbZoom) setKbZoom(false);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving, kbZoom]);

  const perCuota = installmentAmount(parseNum(cardTotal), parseNum(cardInstallments));

  async function save() {
    if (!title.trim()) {
      toast.error("Ingresá un título para el evento");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        kind,
        status,
        announceAt: localToIso(announceAt),
        eventAt: localToIso(eventAt),
        eventEndAt: hasEnd ? localToIso(eventEndAt) : null,
        cardTotal: parseNum(cardTotal),
        cardInstallments: parseNum(cardInstallments),
        transferPrice: parseNum(transferPrice),
        internationalPrice: parseNum(internationalPrice),
        details: details.trim() || null,
        landingUrl: landingUrl.trim() || null,
      };
      const res = await fetch(
        editing ? `/api/events/${event.id}` : "/api/events",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo guardar el evento");
        return;
      }
      toast.success(editing ? "Evento actualizado" : "Evento creado");
      onSaved();
    } catch {
      toast.error("Error de red");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto glass rounded-xl border border-neutral-200 p-5 shadow-soft dark:border-neutral-800 dark:shadow-soft-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
            {editing ? "Editar evento" : "Nuevo evento"}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 transition hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Título */}
        <div className="mt-4">
          <label className={fieldLabel}>Título</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='Ej: "Masterclass de Peeling Químico"'
            className={`mt-1.5 ${textInput}`}
          />
        </div>

        {/* Tipo (fila completa, evita que el 3er estado se corte) */}
        <div className="mt-3">
          <label className={fieldLabel}>Tipo</label>
          <div className="mt-1.5">
            <Segmented<Kind>
              value={kind}
              onChange={setKind}
              options={[
                { value: "masterclass", label: "Masterclass" },
                { value: "congress", label: "Congreso" },
              ]}
            />
          </div>
        </div>

        {/* Estado (fila completa) */}
        <div className="mt-3">
          <label className={fieldLabel}>Estado</label>
          <div className="mt-1.5">
            <Segmented<Status>
              value={status}
              onChange={setStatus}
              options={[
                { value: "borrador", label: "Borrador" },
                { value: "activo", label: "Activo" },
                { value: "archivado", label: "Archivado" },
              ]}
            />
          </div>
        </div>

        {/* Fecha de lanzamiento */}
        <div className="mt-3">
          <DateTimeField
            value={announceAt}
            onChange={setAnnounceAt}
            label="Fecha de lanzamiento"
            helpText="A partir de cuándo el agente puede comunicar el evento"
          />
        </div>

        {/* Fecha del evento (con segundo día opcional para eventos multi-día) */}
        <div className="mt-3">
          <DateTimeField
            value={eventAt}
            onChange={setEventAt}
            label={hasEnd ? "Inicio del evento" : "Fecha del evento"}
          />
          {hasEnd ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className={fieldLabel}>Cierre del evento</span>
                <button
                  type="button"
                  onClick={() => setHasEnd(false)}
                  className="flex items-center gap-1 text-[11px] text-neutral-500 transition hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                  Quitar
                </button>
              </div>
              <div className="mt-1.5">
                <DateTimeField value={eventEndAt} onChange={setEventEndAt} label="" />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setHasEnd(true);
                setEventEndAt(eventAt);
              }}
              className="mt-1.5 flex items-center gap-1 text-[11.5px] text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              Agregar segundo día
            </button>
          )}
        </div>

        {/* Módulo de precios: agrupa las tres formas de pago. */}
        <div className="mt-4">
          <label className={fieldLabel}>Precios</label>
          <div className="mt-1.5 space-y-3 rounded-md border border-neutral-200 bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
            {/* Con tarjeta: precio total + cuotas, monto por cuota calculado. */}
            <div>
              <span className={subLabel}>Con tarjeta (ARS)</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input
                  value={cardTotal}
                  onChange={(e) => setCardTotal(e.target.value)}
                  inputMode="numeric"
                  placeholder="Precio total"
                  className={textInput}
                />
                <input
                  value={cardInstallments}
                  onChange={(e) => setCardInstallments(e.target.value)}
                  inputMode="numeric"
                  placeholder="Cuotas"
                  className={textInput}
                />
              </div>
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-500">
                {perCuota != null
                  ? `Cada cuota: ${formatARS(perCuota)}`
                  : "El monto por cuota se calcula solo (total ÷ cuotas)"}
              </p>
            </div>

            {/* Transferencia + internacional */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className={subLabel}>Transferencia (ARS)</span>
                <input
                  value={transferPrice}
                  onChange={(e) => setTransferPrice(e.target.value)}
                  inputMode="numeric"
                  placeholder="Ej: 105000"
                  className={`mt-1 ${textInput}`}
                />
              </div>
              <div>
                <span className={subLabel}>Internacional (USD)</span>
                <input
                  value={internationalPrice}
                  onChange={(e) => setInternationalPrice(e.target.value)}
                  inputMode="numeric"
                  placeholder="Ej: 100"
                  className={`mt-1 ${textInput}`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Link de la landing / web del evento */}
        <div className="mt-4">
          <label className={fieldLabel}>Link de la landing</label>
          <input
            value={landingUrl}
            onChange={(e) => setLandingUrl(e.target.value)}
            inputMode="url"
            placeholder="https://..."
            className={`mt-1.5 ${textInput}`}
          />
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-500">
            El agente puede compartirlo cuando alguien quiere ver más detalle en la web
          </p>
        </div>

        {/* Base de Conocimientos. "Ampliar" va abajo del textarea: el grip de
            resize del propio textarea queda encima, así no se repite el gesto
            de "agrandar" arriba y abajo. */}
        <div className="mt-4">
          <label className={fieldLabel}>Base de Conocimientos</label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={7}
            placeholder="Todo lo que el agente puede contar del evento: modalidad, lugar, qué incluye, certificación, formas de pago, preguntas frecuentes"
            className="mt-1.5 w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] leading-relaxed outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600"
          />
          <div className="mt-1.5 flex items-start justify-between gap-3">
            <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
              Este texto se suma a la base de conocimiento del agente tal cual
            </p>
            <button
              type="button"
              onClick={() => setKbZoom(true)}
              className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              <Maximize2 className="h-3 w-3" strokeWidth={1.75} />
              Ampliar
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 btn-gold"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            {editing ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>

      {/* Zoom de la Base de Conocimientos: editor grande a pantalla casi
          completa para textos largos. */}
      {kbZoom && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/50 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setKbZoom(false)}
        >
          <div
            className="flex h-full max-h-[88vh] w-full max-w-3xl flex-col glass rounded-xl border border-neutral-200 p-5 shadow-soft dark:border-neutral-800 dark:shadow-soft-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
                Base de Conocimientos
              </h3>
              <button
                onClick={() => setKbZoom(false)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Listo
              </button>
            </div>
            <textarea
              autoFocus
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Todo lo que el agente puede contar del evento: modalidad, lugar, qué incluye, certificación, formas de pago, preguntas frecuentes"
              className="mt-3 w-full flex-1 resize-none rounded-md border border-neutral-200 bg-white px-4 py-3 text-[13px] leading-relaxed outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600"
            />
            <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-500">
              Los cambios se guardan al apretar Crear o Guardar en el evento
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
