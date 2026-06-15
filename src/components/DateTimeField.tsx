"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, Clock } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";

// Campo de fecha + hora con popover propio (sin <input type="datetime-local">,
// para no traernos el picker nativo de Windows/Chrome con su azul saturado).
// Valor en formato "YYYY-MM-DDTHH:MM" (hora local), igual que el datetime-local
// que reemplaza, así no impacta a quien lo consume.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocal(s: string | null | undefined): Date {
  if (!s) return new Date();
  const [date, time] = s.split("T");
  if (!date || !time) return new Date();
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
}

const WEEK_DAYS = ["L", "M", "M", "J", "V", "S", "D"];

// Control de hora/minuto: botón −, número editable centrado, botón +. Targets
// grandes (h-7) para que sea cómodo en vez de los spinners nativos diminutos.
function TimeStepper({
  value,
  onDec,
  onInc,
  onSet,
  ariaLabel,
}: {
  value: string;
  onDec: () => void;
  onInc: () => void;
  onSet: (v: string) => void;
  ariaLabel: string;
}) {
  const btn =
    "flex h-7 w-7 items-center justify-center text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
  return (
    <div className="flex items-center overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
      <button type="button" onClick={onDec} className={btn} aria-label={`${ariaLabel} menos`}>
        <Minus className="h-3 w-3" strokeWidth={2} />
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onSet(e.target.value.replace(/\D/g, ""))}
        className="h-7 w-8 border-x border-neutral-200 bg-white text-center font-mono text-[12.5px] text-neutral-900 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        aria-label={ariaLabel}
      />
      <button type="button" onClick={onInc} className={btn} aria-label={`${ariaLabel} más`}>
        <Plus className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
}

export function DateTimeField({
  value,
  onChange,
  label,
  helpText,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  helpText?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = parseLocal(value);
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(current));
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function commit(next: Date) {
    onChange(toLocalString(next));
  }

  function pickDay(d: Date) {
    const next = new Date(d);
    next.setHours(current.getHours(), current.getMinutes(), 0, 0);
    commit(next);
  }

  function setHour(h: number) {
    const next = new Date(current);
    next.setHours(Math.max(0, Math.min(23, h)));
    commit(next);
  }

  function setMinute(m: number) {
    const next = new Date(current);
    next.setMinutes(Math.max(0, Math.min(59, m)));
    commit(next);
  }

  // Steppers con wrap: la hora da la vuelta (23 -> 0), los minutos saltan de
  // a 5 (más cómodo para elegir horarios redondos tipo 15:00, 20:30).
  function stepHour(delta: number) {
    const next = new Date(current);
    next.setHours((current.getHours() + delta + 24) % 24);
    commit(next);
  }

  function stepMinute(delta: number) {
    const next = new Date(current);
    next.setMinutes((current.getMinutes() + delta + 60) % 60);
    commit(next);
  }

  function pickNow() {
    const now = new Date();
    commit(now);
    setViewMonth(startOfMonth(now));
  }

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();

  return (
    <div ref={wrapperRef} className="relative">
      <label className="block text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 flex w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none transition hover:border-neutral-300 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700 dark:focus:border-neutral-600"
      >
        <span>
          {format(current, "EEE d 'de' LLLL, HH:mm", { locale: es })}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-neutral-400 transition ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {helpText && (
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-500">
          {helpText}
        </p>
      )}

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 rounded-md border border-neutral-200 bg-white p-3 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark">
          {/* Header: prev / month / next */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <span className="text-[12px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-100">
              {format(viewMonth, "LLLL yyyy", { locale: es })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          {/* Headers de día */}
          <div className="mt-2 grid grid-cols-7 gap-px text-center font-mono text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {WEEK_DAYS.map((d, i) => (
              <span key={i} className="py-1">
                {d}
              </span>
            ))}
          </div>

          {/* Grid de días */}
          <div className="grid grid-cols-7 gap-px">
            {days.map((d) => {
              const inMonth = isSameMonth(d, viewMonth);
              const selected = isSameDay(d, current);
              const isToday = isSameDay(d, today);
              let cls =
                "flex h-7 items-center justify-center rounded-sm font-mono text-[12px] transition";
              if (selected) {
                cls +=
                  " bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950";
              } else if (inMonth) {
                cls +=
                  " text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";
                if (isToday) {
                  cls +=
                    " ring-1 ring-inset ring-neutral-300 dark:ring-neutral-700";
                }
              } else {
                cls +=
                  " text-neutral-300 hover:bg-neutral-50 dark:text-neutral-700 dark:hover:bg-neutral-900";
              }
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => pickDay(d)}
                  className={cls}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Hora: steppers con −/+ (target grande) + edición directa. */}
          <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
              <TimeStepper
                value={pad(current.getHours())}
                onDec={() => stepHour(-1)}
                onInc={() => stepHour(1)}
                onSet={(v) => setHour(parseInt(v || "0", 10))}
                ariaLabel="Hora"
              />
              <span className="text-[13px] font-medium text-neutral-400">:</span>
              <TimeStepper
                value={pad(current.getMinutes())}
                onDec={() => stepMinute(-5)}
                onInc={() => stepMinute(5)}
                onSet={(v) => setMinute(parseInt(v || "0", 10))}
                ariaLabel="Minuto"
              />
            </div>
            <button
              type="button"
              onClick={pickNow}
              className="rounded-md px-2 py-1 text-[11.5px] text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              Ahora
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
