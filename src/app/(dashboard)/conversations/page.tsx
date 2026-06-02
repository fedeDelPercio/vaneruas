"use client";

import { useState } from "react";
import { Menu, MessagesSquare } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { ConversationList } from "@/components/ConversationList";
import { ConversationPanel, type CommentTarget } from "@/components/ConversationPanel";
import { CommentsPanel } from "@/components/CommentsPanel";
import { JobsDebugPanel } from "@/components/JobsDebugPanel";

// Tab Conversaciones: lista + panel + side-panel de comentarios.
// En mobile la lista es un drawer (se abre con la hamburguesa).

export default function ConversationsPage() {
  const { profile } = useProfile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full">
      <ConversationList
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        selectedId={selectedId}
        sourceFilter="test"
        title="Testing"
        onSelect={(id) => {
          setSelectedId(id);
          setCommentTarget(null);
          setSidebarOpen(false);
        }}
        onDeleted={(id) => {
          if (selectedId === id) {
            setSelectedId(null);
            setCommentTarget(null);
          }
        }}
      />

      {selectedId ? (
        <ConversationPanel
          key={selectedId}
          conversationId={selectedId}
          onOpenComments={setCommentTarget}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-white p-6 text-center dark:bg-neutral-950">
          <MessagesSquare
            className="h-8 w-8 text-neutral-900 dark:text-neutral-50"
            strokeWidth={1.5}
          />
          <div>
            <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-50">
              Ninguna conversación seleccionada
            </p>
            <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-500">
              Elegí una de la lista o creá una nueva para empezar
            </p>
          </div>
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[13px] text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 md:hidden dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
          >
            <Menu className="h-3.5 w-3.5" strokeWidth={1.75} /> Ver conversaciones
          </button>
        </div>
      )}

      {commentTarget && (
        <CommentsPanel target={commentTarget} onClose={() => setCommentTarget(null)} />
      )}

      {/* Panel de debugging del worker: solo para perfiles dev. */}
      {profile?.role === "dev" && <JobsDebugPanel />}
    </div>
  );
}
