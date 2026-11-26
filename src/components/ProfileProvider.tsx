"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { redirectToLogin } from "@/lib/auth/browser";
import { prepareSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  clearStoredProfile,
  getStoredProfile,
  setStoredProfile,
  type StoredProfile,
} from "@/lib/profile";

// Contexto del perfil activo (fase 1, sin auth). El perfil vive en
// localStorage; este provider lo expone a toda la app.

interface ProfileContextValue {
  profile: StoredProfile | null;
  /** false hasta leer localStorage (evita parpadeos en el primer render). */
  ready: boolean;
  selectProfile: (profile: StoredProfile) => void;
  changeProfile: () => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    setProfile(getStoredProfile());
    void prepareSupabaseBrowserClient()
      .catch(() => {
        // Un 401 redirige a login. Ante otros errores, el panel puede
        // cargar sus rutas de servidor y el cliente volverá a pedir el JWT.
      })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  useLayoutEffect(() => {
    const originalFetch = window.fetch;
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const response = await originalFetch.call(window, input, init);
      if (response.status === 401) {
        const url = new URL(input instanceof Request ? input.url : input, window.location.href);
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/") &&
            !url.pathname.startsWith("/api/jobs/") && !url.pathname.startsWith("/api/webhooks/ghl/")) {
          redirectToLogin();
        }
      }
      return response;
    };
    window.fetch = authenticatedFetch;
    return () => {
      if (window.fetch === authenticatedFetch) window.fetch = originalFetch;
    };
  }, []);

  const selectProfile = useCallback((next: StoredProfile) => {
    setStoredProfile(next);
    setProfile(next);
  }, []);

  const changeProfile = useCallback(() => {
    clearStoredProfile();
    setProfile(null);
  }, []);

  return (
    <ProfileContext.Provider value={{ profile, ready, selectProfile, changeProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile() debe usarse dentro de <ProfileProvider>");
  return ctx;
}
