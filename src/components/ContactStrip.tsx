import { MessageCircle, Phone } from "lucide-react";

// ===========================================================================
// Identidad del contacto de WhatsApp (quién escribe), separada del emisor del
// comprobante o del dato del reclamo: muchas veces transfiere una persona y
// escribe otra, y el redirect a GHL no siempre abre la conversación. Mostramos
// el nombre del contacto y el teléfono como link a wa.me (abre el chat directo)
// para poder ubicarla a mano. Compartido por Aprobaciones, Derivaciones y
// Certificados.
// ===========================================================================

export function ContactStrip({
  conversation,
  className = "mt-3",
}: {
  conversation: { displayName: string; phone: string | null };
  className?: string;
}) {
  const waDigits = conversation.phone?.replace(/\D/g, "") ?? "";
  return (
    <div
      className={`rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40 ${className}`}
    >
      <p className="mb-1 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        <MessageCircle className="h-3 w-3" strokeWidth={1.75} />
        Quien escribe
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
          {conversation.displayName}
        </span>
        {conversation.phone &&
          (waDigits ? (
            <a
              href={`https://wa.me/${waDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir en WhatsApp"
              className="flex items-center gap-1.5 font-mono text-[12px] text-neutral-600 transition hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-50"
            >
              <Phone className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
              {conversation.phone}
            </a>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[12px] text-neutral-600 dark:text-neutral-300">
              <Phone className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
              {conversation.phone}
            </span>
          ))}
      </div>
    </div>
  );
}
