import { z } from "zod";

// Schema de alta/edición de un evento, compartido por las rutas POST y PATCH.
// Vive fuera de los route files porque Next.js 15 sólo permite exports
// estándar (handlers HTTP + config) en `route.ts`: exportar el schema desde
// ahí rompe la validación de tipos del route.
//
// Los precios y fechas son opcionales (un evento se puede armar en borrador con
// datos incompletos). Strings vacíos del form se normalizan a null en el
// cliente antes de enviar.
export const eventInputSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio"),
  kind: z.enum(["masterclass", "congress"]),
  status: z.enum(["borrador", "activo", "archivado"]).default("borrador"),
  announceAt: z.string().datetime({ offset: true }).nullable().optional(),
  eventAt: z.string().datetime({ offset: true }).nullable().optional(),
  eventEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  cardTotal: z.number().nonnegative().nullable().optional(),
  cardInstallments: z.number().int().positive().nullable().optional(),
  transferPrice: z.number().nonnegative().nullable().optional(),
  internationalPrice: z.number().nonnegative().nullable().optional(),
  details: z.string().nullable().optional(),
  // Link de la landing / web del evento. Lo carga el panel; el cliente lo manda
  // ya trimmeado o null. No forzamos formato URL estricto para no frenar al que
  // pega un link sin esquema.
  landingUrl: z.string().trim().max(2000).nullable().optional(),
});
