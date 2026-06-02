"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
    setProfile(getStoredProfile());
    setReady(true);
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
