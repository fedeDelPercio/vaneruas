"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, CircleCheck, Clock, KeyRound, Loader2, Pencil } from "lucide-react";
import { normalizeContactEmail } from "@/lib/contact-email";
import type { TiendupEditorMode } from "@/lib/tiendup/status";
import type { SaveEmailResponse } from "@/app/api/wa/contact/[conversationId]/email/route";
import { useProfile } from "../ProfileProvider";

// ===========================================================================
// Campo de mail editable del bloque "Acceso a Tiendup" (ficha de /wa y
// /revision). "Guardar" solo guarda el mail en la conversación; "Enviar a
// Tiendup" lo guarda y da el alta del pago aprobado (POST
// /api/wa/contact/[id]/email). Sin confirmación previa: el server inscribe
// directo (crea el cliente en Tiendup si hace falta). No le manda nada a la
// persona.
//
// `mode` (tiendupEditorMode): "highlight" visible y destacado para reintentar,
// "collapsed" detrás de "Corregir mail" (acceso ya enviado), "normal" visible.
// ===========================================================================

type Result = { tone: "ok" | "bad" | "info"; text: string } | null;
type Busy = null | "save" | "enroll";

export function TiendupEmailEditor({
  conversationId,
  email,
  canEnroll,
  mode,
  onChanged,
}: {
  conversationId: string;
  /** Mail guardado en la conversación. */
  email: string | null;
  /** Hay pago aprobado con curso mapeado (si no, "Enviar a Tiendup" deshabilitado). */
  canEnroll: boolean;
  mode: TiendupEditorMode;
  /** Se guardó el mail o se dio el alta: refrescar ficha y estado de Tiendup. */
  onChanged: () => void;
}) {
  const { profile } = useProfile();
  const [value, setValue] = useState(email ?? "");
  const [dirty, setDirty] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<Result>(null);
  // Modo colapsado: el equipo abrió el campo con "Corregir mail".
  const [open, setOpen] = useState(false);

  // Si el mail guardado cambia (realtime / refresh) y no se está editando, se sigue.
  useEffect(() => {
    if (!dirty) setValue(email ?? "");
  }, [email, dirty]);

  async function submit(enroll: boolean) {
    const normalized = normalizeContactEmail(value);
    if (!normalized) {
      setInvalid(true);
      setResult(null);
      return;
    }
    if (!profile) {
      setResult({ tone: "bad", text: "Elegí un perfil para continuar" });
      return;
    }
    setInvalid(false);
    setResult(null);
    setBusy(enroll ? "enroll" : "save");
    try {
      const r = await fetch(`/api/wa/contact/${conversationId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized, enroll, profileId: profile.id }),
      });
      const j = (await r.json().catch(() => ({}))) as SaveEmailResponse;
      if (r.status === 202 && j.queued) {
        setResult({ tone: "info", text: j.message ?? "Quedó en cola de reintento" });
      } else if (!r.ok || !j.ok) {
        if (r.status === 400 && j.error === "Mail inválido") setInvalid(true);
        else setResult({ tone: "bad", text: j.error ?? "No se pudo guardar" });
      } else if (enroll) {
        setResult({
          tone: "ok",
          text: j.alreadyEnrolled ? "Ya figuraba inscripta en Tiendup" : "Acceso enviado a Tiendup",
        });
        // Si el bloque pasa a "enviado", vuelve al link chico (con el resultado).
        setOpen(false);
      } else {
        setResult({ tone: "ok", text: "Mail guardado" });
      }
      // El mail se guarda antes del alta: aunque el alta falle, la ficha ya
      // tiene el mail nuevo.
      if (j.email) {
        setValue(j.email);
        setDirty(false);
        onChanged();
      }
    } catch {
      setResult({ tone: "bad", text: "Error de red" });
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  const resultLine = result && <ResultLine result={result} />;

  // Acceso ya enviado: link chico. El resultado del último envío se sigue
  // viendo aunque el bloque pase a "enviado" con el refresh.
  if (mode === "collapsed" && !open) {
    return (
      <div className="mt-3 border-t border-neutral-200 pt-2.5 dark:border-neutral-800">
        {resultLine}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setResult(null);
          }}
          className={`flex items-center gap-1 text-[11.5px] text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 ${
            result ? "mt-1.5" : ""
          }`}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Corregir mail
        </button>
      </div>
    );
  }

  const highlight = mode === "highlight";
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={
        highlight
          ? "mt-3 rounded-lg border border-gold/40 bg-neutral-50 p-2.5 dark:border-gold/30 dark:bg-neutral-900/60"
          : "mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800"
      }
    >
      <label
        htmlFor={`tiendup-mail-${conversationId}`}
        className="text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300"
      >
        {!highlight
          ? "Mail para el acceso"
          : email?.trim()
            ? "Corregí el mail y reintentá el alta"
            : "Cargá el mail para dar el acceso"}
      </label>
      <input
        id={`tiendup-mail-${conversationId}`}
        type="email"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
          setInvalid(false);
          setResult(null);
        }}
        placeholder="nombre@gmail.com"
        aria-invalid={invalid}
        disabled={busy !== null}
        className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-[13px] outline-none transition placeholder:text-neutral-400 disabled:opacity-60 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 ${
          invalid ? "border-red-500/70 dark:border-red-500/60" : "border-neutral-200 dark:border-neutral-800"
        }`}
      />
      {invalid && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">Mail inválido</p>}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          Guardar
        </button>
        {/* El span lleva el tooltip: un botón deshabilitado no dispara hover. */}
        <span title={canEnroll ? undefined : "Necesita un pago aprobado"}>
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={!canEnroll || busy !== null}
            className="flex items-center gap-1.5 btn-gold"
          >
            {busy === "enroll" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Enviar a Tiendup
          </button>
        </span>
      </div>

      {resultLine}
    </form>
  );
}

function ResultLine({ result }: { result: NonNullable<Result> }) {
  return (
    <p
      role="status"
      className={`mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug ${
        result.tone === "ok"
          ? "text-ok-fg dark:text-ok"
          : result.tone === "info"
            ? "text-neutral-600 dark:text-neutral-300"
            : "text-red-700 dark:text-red-400"
      }`}
    >
      {result.tone === "ok" ? (
        <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      ) : result.tone === "info" ? (
        <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} />
      ) : (
        <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      )}
      <span className="min-w-0 break-words">{result.text}</span>
    </p>
  );
}
