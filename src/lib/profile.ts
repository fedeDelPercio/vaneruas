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
