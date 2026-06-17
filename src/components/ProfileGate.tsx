"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { UserPlus, Loader2, ChevronRight, X } from "lucide-react";
import { useProfile } from "./ProfileProvider";
import { Avatar } from "./Avatar";
import type { Profile, ProfileRole } from "@/lib/supabase/types";
import { roleLabel } from "@/lib/profile";

// Pantalla "¿Quién sos?": se muestra cuando no hay perfil en localStorage.

export function ProfileGate() {
  const { selectProfile } = useProfile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Cuando es true, el row "Crear perfil nuevo" se transforma en el form.
  // En el estado inicial mostramos solo el row (estilo perfiles existentes)
  // para que la pantalla quede mas calma y enfocada en elegir un perfil.
  const [creatingMode, setCreatingMode] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<ProfileRole>("client");
  // Brand logo opcional: si `/brand-logo.png` existe (branches con marca
  // de cliente), se muestra centrado arriba del titulo. Si no existe
  // (default en main), onError esconde el <img> y solo queda "Agentic
  // Panel" como header.
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => toast.error("No se pudieron cargar los perfiles"))
      .finally(() => setLoading(false));
  }, []);

  async function createProfile() {
    if (!name.trim()) {
      toast.error("Ingresá un nombre");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo crear el perfil");
        return;
      }
      selectProfile({ id: data.profile.id, name: data.profile.name, role: data.profile.role });
    } catch {
      toast.error("Error de red al crear el perfil");
    } finally {
      setCreating(false);
    }
  }

  function cancelCreate() {
    if (creating) return;
    setCreatingMode(false);
    setName("");
    setRole("client");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4 dark:bg-neutral-950">
      <div className="w-full max-w-md p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          {!logoError && (
            <img
              src="/brand-logo.png"
              alt=""
              onLoad={() => setLogoLoaded(true)}
              onError={() => setLogoError(true)}
              className={`h-10 w-auto transition-opacity invert dark:invert-0 ${
                logoLoaded ? "opacity-100" : "opacity-0"
              }`}
            />
          )}
          <span className="font-mono text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
            Agentic Panel
          </span>
        </div>
        <h1 className="mt-5 text-center text-[20px] font-medium tracking-tight-er text-neutral-900 dark:text-neutral-50">
          ¿Quién sos?
        </h1>
        <p className="mt-1 text-center text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Elegí tu perfil para entrar. Los comentarios y las conversaciones
          quedan firmados con él.
        </p>

        <div className="mt-6">
          {loading ? (
            <div className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> Cargando perfiles…
            </div>
          ) : profiles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
              Todavía no hay perfiles. Creá el primero abajo.
            </p>
          ) : (
            <ul className="space-y-1">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() =>
                      selectProfile({ id: p.id, name: p.name, role: p.role as ProfileRole })
                    }
                    className="group flex w-full items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 text-left transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    <Avatar name={p.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                        {p.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
                        {roleLabel(p.role as ProfileRole)}
                      </p>
                    </div>
                    <ChevronRight
                      className="h-4 w-4 text-neutral-300 transition group-hover:text-neutral-700 dark:text-neutral-700 dark:group-hover:text-neutral-300"
                      strokeWidth={1.75}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
          {!creatingMode ? (
            <button
              onClick={() => setCreatingMode(true)}
              className="group flex w-full items-center gap-3 rounded-lg border border-dashed border-neutral-300 px-3 py-2.5 text-left transition hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-neutral-300 text-neutral-500 transition group-hover:border-neutral-400 group-hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-400 dark:group-hover:border-neutral-600 dark:group-hover:text-neutral-200">
                <UserPlus className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                  Crear perfil nuevo
                </p>
                <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
                  Nombre + rol
                </p>
              </div>
              <ChevronRight
                className="h-4 w-4 text-neutral-300 transition group-hover:text-neutral-700 dark:text-neutral-700 dark:group-hover:text-neutral-300"
                strokeWidth={1.75}
              />
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  Crear perfil nuevo
                </p>
                <button
                  onClick={cancelCreate}
                  disabled={creating}
                  className="rounded p-0.5 text-neutral-400 transition hover:text-neutral-700 disabled:opacity-40 dark:hover:text-neutral-300"
                  aria-label="Cancelar"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="mt-3 space-y-2.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createProfile();
                    if (e.key === "Escape") cancelCreate();
                  }}
                  placeholder="Tu nombre"
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-600"
                />
                <div className="grid grid-cols-3 gap-2">
                  {(["client", "asesor", "dev"] as ProfileRole[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={`rounded-lg border px-2 py-2 text-[12.5px] transition ${
                        role === r
                          ? "border-neutral-900 bg-neutral-900 font-medium text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-950"
                          : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
                      }`}
                    >
                      {roleLabel(r)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={createProfile}
                  disabled={creating}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-gold to-gold-start px-3 py-2.5 text-[13px] font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  Crear y entrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
