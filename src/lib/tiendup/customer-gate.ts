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
//   manual (botón "Dar acceso al curso"):
//     - existe → inscribe;
//     - no existe / no se pudo verificar → pide confirmación explícita al
//       equipo (409 needsConfirm) y, con `confirmNewCustomer` (o `force`),
//       inscribe igual.
//
// Puro (tests sin red en scripts/test-tiendup-customers.ts).
// ===========================================================================

import { findCustomerByEmail, type CustomersListing } from "./customers";
import { findExistingEnrollment, type TiendupEnrolled } from "./match";

export type CustomerGateReason = "not_in_tiendup" | "customer_check_failed";

export type CustomerGate =
  | { action: "enroll" }
  | { action: "block"; reason: CustomerGateReason }
  | { action: "confirm"; reason: CustomerGateReason };

/** ¿Hace falta leer el listado de clientes? (manual forzado / confirmado no lo necesita). */
export function customerCheckNeeded(args: {
  mode: "manual" | "auto";
  force?: boolean;
  confirmNewCustomer?: boolean;
}): boolean {
  if (args.mode === "auto") return true;
  return !(args.force || args.confirmNewCustomer);
}

export function decideCustomerGate(args: {
  mode: "manual" | "auto";
  force?: boolean;
  confirmNewCustomer?: boolean;
  listing: Pick<CustomersListing, "complete" | "customers"> | null;
  email: string;
}): CustomerGate {
  if (!customerCheckNeeded(args)) return { action: "enroll" };
  const stop = args.mode === "auto" ? "block" : "confirm";
  const listing = args.listing;
  if (!listing || !listing.complete) return { action: stop, reason: "customer_check_failed" };
  if (findCustomerByEmail(listing.customers, args.email)) return { action: "enroll" };
  return { action: stop, reason: "not_in_tiendup" };
}

// --- Decisión completa del alta (antes de tocar Tiendup con un POST) --------

export type GrantAction =
  /** Ya figura en el curso con este correo: solo se marca en el panel. */
  | { action: "already_enrolled" }
  /** Figura la persona (por nombre) con OTRO correo y no se forzó. */
  | { action: "name_conflict"; existing: TiendupEnrolled }
  | CustomerGate;

/**
 * Orden: inscripta por correo → `already_enrolled`; por nombre con otro
 * correo (sin force) → `name_conflict`; si no, gate de clientes
 * (decideCustomerGate). El listado de clientes se pide solo si hace falta
 * (`loadCustomers` es lazy: con force / confirmNewCustomer, o si ya está
 * inscripta, no se lee).
 */
export async function decideGrantAction(args: {
  mode: "manual" | "auto";
  force?: boolean;
  confirmNewCustomer?: boolean;
  enrolled: TiendupEnrolled[];
  email: string;
  fullName: string | null;
  loadCustomers: () => Promise<Pick<CustomersListing, "complete" | "customers"> | null>;
}): Promise<GrantAction> {
  const force = args.mode === "manual" && args.force === true;
  const confirmNewCustomer = args.mode === "manual" && args.confirmNewCustomer === true;
  const existing = findExistingEnrollment({
    enrolled: args.enrolled,
    email: args.email,
    fullName: args.fullName,
  });
  if (existing?.matchedBy === "email") return { action: "already_enrolled" };
  if (existing?.matchedBy === "nombre" && !force) {
    return { action: "name_conflict", existing: existing.enrolled };
  }
  const gateArgs = { mode: args.mode, force, confirmNewCustomer };
  const listing = customerCheckNeeded(gateArgs) ? await args.loadCustomers() : null;
  return decideCustomerGate({ ...gateArgs, listing, email: args.email });
}
