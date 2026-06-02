"use client";

import { useCallback, useEffect, useState } from "react";
import { useProfile } from "@/components/ProfileProvider";
import { WebhookForm } from "@/components/webhooks/WebhookForm";
import { WebhooksList } from "@/components/webhooks/WebhooksList";
import { DeliveriesTable } from "@/components/webhooks/DeliveriesTable";
import type { OutboundWebhook } from "@/lib/supabase/types";

// Tab Webhooks (solo dev): CRUD de webhooks salientes + tabla de entregas.

export default function WebhooksPage() {
  const { profile } = useProfile();
  const [webhooks, setWebhooks] = useState<OutboundWebhook[]>([]);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/outbound-webhooks");
    if (res.ok) {
      const data = await res.json();
      setWebhooks(data.webhooks ?? []);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Guard: el tab no deberia ser accesible para no-dev, pero por las dudas.
  if (profile && profile.role !== "dev") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">
        Esta sección es solo para perfiles dev.
      </div>
    );
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Webhooks salientes
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Notificaciones HTTP que el panel dispara ante eventos del agente
            (mensaje recibido, respuesta, escalación, fallo).
          </p>
        </div>

        <WebhookForm onCreated={refetch} />
        <WebhooksList webhooks={webhooks} onChanged={refetch} />
        <DeliveriesTable />
      </div>
    </div>
  );
}
