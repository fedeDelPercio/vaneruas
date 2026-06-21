"use client";

import type { ProfileRole } from "@/lib/supabase/types";

// ===========================================================================
// Helpers de perfil (fase 1, sin auth real).
//
// El perfil activo se guarda en localStorage. El modo de vista (simple vs
// avanzada) se deriva del role del profile en ConversationPanel — no se
// persiste por perfil ni se elige manualmente.
// ===========================================================================

export interface StoredProfile {
  id: string;
  name: string;
  role: ProfileRole;
}

export type ViewMode = "simple" | "advanced";

const PROFILE_KEY = "atp.profile";

/** Devuelve el perfil activo guardado, o null si no hay. */
export function getStoredProfile(): StoredProfile | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredProfile;
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Guarda el perfil activo. */
export function setStoredProfile(profile: StoredProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/** Borra el perfil activo (boton "cambiar perfil"). */
export function clearStoredProfile(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PROFILE_KEY);
}

// ===========================================================================
// Access control por rol.
//
// Cada ruta del dashboard declara qué roles la pueden ver. La tabla es la
// SSOT: la usan DashboardHeader (para filtrar tabs) y el layout (para
// rebotar si el rol logueado entra por URL directa).
//
// Roles:
//   - dev    -> todo (panel completo: Testing, Feedback, Webhooks, etc.)
//   - client -> operación: WhatsApp, Aprobaciones, Derivaciones, Certificados,
//               Eventos, Métricas. SIN Testing ni Feedback (solo dev).
//   - asesor -> mismo set operativo que client.
//
// Cuando un cliente clone este template y sume módulos propios (ej. /leads
// en Quintaglia), tiene que agregar las rutas correspondientes a esta tabla.
// ===========================================================================

const ROLE_ACCESS: Record<string, ProfileRole[]> = {
  "/conversations": ["dev"],
  "/feedback": ["dev"],
  "/wa": ["dev", "client", "asesor"],
  "/payments": ["dev", "client", "asesor"],
  "/interventions": ["dev", "client", "asesor"],
  "/certificados": ["dev", "client", "asesor"],
  "/events": ["dev", "client", "asesor"],
  "/metrics": ["dev", "client", "asesor"],
  "/webhooks": ["dev"],
};

/**
 * Devuelve true si `role` puede entrar a una ruta cuyo path empieza con
 * cualquiera de las keys de ROLE_ACCESS. Rutas no listadas se consideran
 * abiertas.
 */
export function canAccess(role: ProfileRole, path: string): boolean {
  for (const [prefix, allowed] of Object.entries(ROLE_ACCESS)) {
    if (path.startsWith(prefix)) return allowed.includes(role);
  }
  return true;
}

/** Ruta a la que mandar al usuario sin destino válido. */
export function defaultRouteForRole(role: ProfileRole): string {
  // dev arranca en Testing; el resto (client / asesor) no accede a Testing,
  // así que su home es WhatsApp.
  if (role === "dev") return "/conversations";
  return "/wa";
}

/** Etiqueta humana del rol (para la UI). */
export function roleLabel(role: ProfileRole): string {
  if (role === "dev") return "Desarrollador";
  if (role === "asesor") return "Asesor";
  return "Cliente";
}
