import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { ghlConversationUrl, type GhlLinkConversation } from "@/lib/ghl-link";

// Accesos a la conversación de un contacto desde las bandejas (Aprobaciones,
// Derivaciones, Certificados, Agendar): "Ver chat" abre la conversación en el
// chat del panel, y el link a GoHighLevel queda al lado para quien prefiera
// seguirla allá.

export function ConversationLinks({
  conversation,
  className = "",
}: {
  conversation: GhlLinkConversation;
  className?: string;
}) {
  const ghlUrl = ghlConversationUrl(conversation);
  const chatHref =
    conversation.source === "whatsapp"
      ? `/wa?id=${conversation.id}`
      : `/conversations?id=${conversation.id}`;
  const linkClass =
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50";
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <Link href={chatHref} className={linkClass}>
        Ver chat
        <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
      </Link>
      {ghlUrl && (
        <a
          href={ghlUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir el contacto en GoHighLevel"
          className={linkClass}
        >
          GHL
          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
        </a>
      )}
    </div>
  );
}
