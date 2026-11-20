// ===========================================================================
// "No crear clientes nuevos en Tiendup": decisión previa al POST enroll.
//
// Se evalúa SOLO cuando el alta está por inscribir (la persona no figura en
// el curso ni con el correo ni con el nombre). El enroll de Tiendup crea el
// cliente si no existe, así que antes se chequea que el correo exista como
// CLIENTE de la tienda (GET /customers, ver customers.ts):
//
//   automático (nadie mira el caso):
//     - existe como cliente → inscribe;
//     - no existe → NO inscribe (`not_in_tiendup`): queda el error
//       "NOT_IN_TIENDUP: …" en el comprobante y la notificación de alta
//       pendiente para el equipo;
//     - listado incompleto o caído → NO inscribe (`customer_check_failed`),
//       mismo criterio estricto que con el listado de inscriptos. Aunque el
//       correo aparezca en un listado parcial, no se inscribe: no se afirma
//       nada con datos cortados.
//   manual (botón "Dar acceso al curso" y "Enviar a Tiendup" de la ficha):
//     - no hay gate: inscribe directo, aunque el correo no sea cliente (Tiendup
//       lo crea) y aunque la persona figure por nombre con otro correo. Lo
//       decide el equipo, sin confirmación previa (20/11/2026).
//
// Puro (tests sin red en scripts/test-tiendup-customers.ts).
// ===========================================================================

import { findCustomerByEmail, type CustomersListing } from "./customers";
import { findExistingEnrollment, type TiendupEnrolled } from "./match";

export type CustomerGateReason = "not_in_tiendup" | "customer_check_failed";

export type CustomerGate =
  | { action: "enroll" }
  | { action: "block"; reason: CustomerGateReason };

/** ¿Hace falta leer el listado de clientes? Solo en automático. */
export function customerCheckNeeded(args: { mode: "manual" | "auto" }): boolean {
  return args.mode === "auto";
}

export function decideCustomerGate(args: {
  mode: "manual" | "auto";
  listing: Pick<CustomersListing, "complete" | "customers"> | null;
  email: string;
}): CustomerGate {
  if (!customerCheckNeeded(args)) return { action: "enroll" };
  const listing = args.listing;
  if (!listing || !listing.complete) return { action: "block", reason: "customer_check_failed" };
  if (findCustomerByEmail(listing.customers, args.email)) return { action: "enroll" };
  return { action: "block", reason: "not_in_tiendup" };
}

// --- Decisión completa del alta (antes de tocar Tiendup con un POST) --------

export type GrantAction =
  /** Ya figura en el curso con este correo: solo se marca en el panel. */
  | { action: "already_enrolled" }
  /** Auto: figura la persona (por nombre) con OTRO correo. */
  | { action: "name_conflict"; existing: TiendupEnrolled }
  | CustomerGate;

/**
 * Orden: inscripta por correo → `already_enrolled`. Manual: si no, inscribe
 * (sin chequeo de nombre ni de cliente). Auto: por nombre con otro correo →
 * `name_conflict`; si no, gate de clientes (decideCustomerGate). El listado de
 * clientes se pide solo en automático (`loadCustomers` es lazy).
 */
export async function decideGrantAction(args: {
  mode: "manual" | "auto";
  enrolled: TiendupEnrolled[];
  email: string;
  fullName: string | null;
  loadCustomers: () => Promise<Pick<CustomersListing, "complete" | "customers"> | null>;
}): Promise<GrantAction> {
  const existing = findExistingEnrollment({
    enrolled: args.enrolled,
    email: args.email,
    fullName: args.fullName,
  });
  if (existing?.matchedBy === "email") return { action: "already_enrolled" };
  if (args.mode === "manual") return { action: "enroll" };
  if (existing?.matchedBy === "nombre") {
    return { action: "name_conflict", existing: existing.enrolled };
  }
  const listing = await args.loadCustomers();
  return decideCustomerGate({ mode: args.mode, listing, email: args.email });
}
