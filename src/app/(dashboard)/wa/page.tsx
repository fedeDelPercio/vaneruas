"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Menu, MessagesSquare } from "lucide-react";
import { CommentsPanel } from "@/components/CommentsPanel";
import type { CommentTarget } from "@/components/ConversationPanel";
import { WaConversationList } from "@/components/wa/WaConversationList";
import { WaChatPanel } from "@/components/wa/WaChatPanel";
import { ContactPanel } from "@/components/wa/ContactPanel";
import type { ConversationMode } from "@/components/wa/ModeToggle";

// Tab WhatsApp: la bandeja real. Lista con buscador a la izquierda, chat en
// el medio y ficha del contacto (eventos, pagos, accesos) a la derecha.
//
// La conversación abierta vive en la URL (?id=...), así el link se puede
// compartir, sobrevive a un refresh y los otros módulos pueden abrir un chat
// puntual con "Ver chat".

const FICHA_PREF_KEY = "atp.wa.ficha";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// La ficha entra al costado sin tapar el chat recién desde este ancho.
const FICHA_INLINE_MIN_WIDTH = 1280;

function WhatsAppInbox() {
  const searchParams = useSearchParams();
  const urlId = searchParams.get("id");
  // La conversación abierta se guarda también en estado: así el clic en la
  // lista responde al instante. Antes dependía solo de la URL, y router.replace
  // espera al servidor antes de cambiarla (a veces varios segundos sin señal).
  const [selectedId, setSelectedId] = useState<string | null>(urlId);
  useEffect(() => {
    setSelectedId(urlId);
  }, [urlId]);

  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [renamed, setRenamed] = useState<{ id: string; name: string } | null>(null);
  const [modeChanged, setModeChanged] = useState<{ id: string; mode: ConversationMode } | null>(null);

  // Preferencia de la ficha: abierta por defecto si entra al costado.
  useEffect(() => {
    let pref: string | null = null;
    try {
      pref = window.localStorage.getItem(FICHA_PREF_KEY);
    } catch {
      // Sin storage (modo privado): se usa el default.
    }
    const wide = window.innerWidth >= FICHA_INLINE_MIN_WIDTH;
    setFichaOpen(wide && pref !== "closed");
  }, []);

  const setFicha = useCallback((next: boolean) => {
    setFichaOpen(next);
    try {
      window.localStorage.setItem(FICHA_PREF_KEY, next ? "open" : "closed");
    } catch {
      // idem
    }
  }, []);

  const toggleFicha = useCallback(() => {
    // Con las notas abiertas la ficha está tapada: el botón la trae de vuelta
    // (cierra las notas) en vez de cerrar las dos cosas.
    if (commentTarget) {
      setCommentTarget(null);
      setFicha(true);
      return;
    }
    setFicha(!fichaOpen);
  }, [commentTarget, fichaOpen, setFicha]);

  const select = useCallback(
    (id: string | null) => {
      setCommentTarget(null);
      setSidebarOpen(false);
      setSelectedId(id);
      const params = new URLSearchParams(searchParams);
      if (id) params.set("id", id);
      else params.delete("id");
      params.delete("highlight");
      const qs = params.toString();
      // Solo actualiza la URL (Next la refleja en useSearchParams), sin ida y
      // vuelta al servidor.
      window.history.replaceState(null, "", qs ? `/wa?${qs}` : "/wa");
    },
    [searchParams],
  );

  return (
    <div className="flex h-full">
      <WaConversationList
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        selectedId={selectedId}
        onSelect={select}
        renamed={renamed}
        modeChanged={modeChanged}
      />

      {selectedId ? (
        <WaChatPanel
          key={selectedId}
          conversationId={selectedId}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenComments={(target) => {
            setCommentTarget(target);
          }}
          onRenamed={(id, name) => setRenamed({ id, name })}
          onModeChanged={(id, mode) => setModeChanged({ id, mode })}
          fichaOpen={fichaOpen && !commentTarget}
          onToggleFicha={toggleFicha}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-white p-6 text-center dark:bg-neutral-950">
          <MessagesSquare className="h-8 w-8 text-neutral-300 dark:text-neutral-700" strokeWidth={1.5} />
          <div>
            <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
              Elegí una conversación
            </p>
            <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-500">
              Buscá por nombre o teléfono, o elegí una de la lista
            </p>
          </div>
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 md:hidden dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
          >
            <Menu className="h-3.5 w-3.5" strokeWidth={1.75} /> Ver conversaciones
          </button>
        </div>
      )}

      {selectedId && UUID_RE.test(selectedId) && fichaOpen && !commentTarget && (
        <ContactPanel key={`ficha-${selectedId}`} conversationId={selectedId} onClose={toggleFicha} />
      )}

      {commentTarget && (
        <CommentsPanel target={commentTarget} onClose={() => setCommentTarget(null)} />
      )}
    </div>
  );
}

export default function WhatsAppPage() {
  // useSearchParams necesita un límite de Suspense para el render estático.
  return (
    <Suspense fallback={null}>
      <WhatsAppInbox />
    </Suspense>
  );
}
