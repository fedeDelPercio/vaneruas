"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

const WIDTH_KEY = "vr.chatPaneWidth";
const MIN_CHAT = 320;
const MIN_CONTENT = 360;
const DIVIDER = 8;

export function ResizableChatPane({ children, chat, onClose }: {
  children: ReactNode;
  chat: ReactNode;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const paneId = useId();
  const [preferredWidth, setPreferredWidth] = useState(420);
  const [containerWidth, setContainerWidth] = useState(0);
  const open = Boolean(chat);
  const maxWidth = Math.max(MIN_CHAT, containerWidth - MIN_CONTENT - DIVIDER);
  const clamp = (width: number) => Math.max(MIN_CHAT, Math.min(maxWidth, width));
  const width = clamp(preferredWidth);

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(stored) && stored >= MIN_CHAT) setPreferredWidth(stored);
    } catch {
      // El ajuste sigue disponible si el navegador bloquea el almacenamiento.
    }
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);

  function resize(next: number) {
    const value = clamp(next);
    setPreferredWidth(value);
    try {
      localStorage.setItem(WIDTH_KEY, String(value));
    } catch {
      // El ancho queda en memoria durante la visita.
    }
  }

  return (
    <div
      ref={container}
      className="flex h-full min-h-0 w-full"
      onKeyDown={(event) => {
        if (open && event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={`min-h-0 min-w-0 flex-1 ${open ? "max-lg:hidden" : ""}`}>{children}</div>
      {open && (
        <>
          <div
            role="separator"
            aria-label="Ancho de la conversación"
            aria-orientation="vertical"
            aria-controls={paneId}
            aria-valuemin={MIN_CHAT}
            aria-valuemax={maxWidth}
            aria-valuenow={width}
            tabIndex={0}
            className="hidden w-2 shrink-0 touch-none cursor-col-resize bg-neutral-100 outline-none hover:bg-gold/30 focus-visible:bg-gold/30 lg:block dark:bg-neutral-800 dark:hover:bg-gold/30"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const right = container.current?.getBoundingClientRect().right;
              if (right !== undefined) resize(right - event.clientX - DIVIDER / 2);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              resize(width + (event.key === "ArrowLeft" ? 24 : -24));
            }}
          />
          <aside
            id={paneId}
            aria-label="Conversación"
            style={{ "--chat-pane-width": `${width}px` } as React.CSSProperties}
            className="fixed inset-x-0 top-0 z-40 flex h-[var(--app-viewport-height,100dvh)] min-h-0 min-w-0 flex-col bg-white lg:static lg:h-full lg:w-[var(--chat-pane-width)] lg:shrink-0 dark:bg-neutral-950"
          >
            <div className="flex shrink-0 justify-between border-b border-neutral-200 px-3 py-1 dark:border-neutral-800 lg:justify-end">
              <button ref={closeButton} type="button" aria-label="Cerrar conversación" onClick={onClose}
                className="flex items-center gap-1.5 rounded-lg p-2 text-[13px] hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <ArrowLeft className="h-4 w-4 lg:hidden" strokeWidth={1.75} />
                <span className="lg:hidden">Volver</span>
                <X className="hidden h-4 w-4 lg:block" strokeWidth={1.75} />
              </button>
            </div>
            <div className="min-h-0 flex-1">{chat}</div>
          </aside>
        </>
      )}
    </div>
  );
}
