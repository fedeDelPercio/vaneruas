"use client";

import { Suspense } from "react";
import { ReviewWorkspace } from "@/components/revision/ReviewWorkspace";

// Revisión: la "foto completa" para aprobar. Pendientes a la izquierda, el chat
// de WhatsApp de esa persona al medio y, a la derecha, el archivo con Aprobar /
// Rechazar, sus derivaciones abiertas y el estado del acceso a Tiendup.
// El ítem seleccionado vive en la URL (?id=).

export default function RevisionPage() {
  // useSearchParams necesita un límite de Suspense para el render estático.
  return (
    <Suspense fallback={null}>
      <ReviewWorkspace />
    </Suspense>
  );
}
