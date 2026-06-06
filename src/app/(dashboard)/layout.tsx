"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProfileProvider, useProfile } from "@/components/ProfileProvider";
import { ProfileGate } from "@/components/ProfileGate";
import { DashboardHeader } from "@/components/DashboardHeader";
import { canAccess, defaultRouteForRole, roleLabel } from "@/lib/profile";

// Layout del dashboard: monta el ProfileProvider y aplica el gate de perfil.
// Sin perfil -> ProfileGate. Con perfil -> header + contenido de la tab.
// Access control: si el rol no puede ver la ruta actual (canAccess() lo
// dice), redirigimos al default del rol. Los tabs del header ya están
// filtrados, pero esto cubre URLs directas (asesor pegando /webhooks, etc).

function DashboardShell({ children }: { children: ReactNode }) {
  const { profile, ready } = useProfile();
  const pathname = usePathname();
  const router = useRouter();

  const blocked = profile ? !canAccess(profile.role, pathname) : false;

  useEffect(() => {
    if (profile && blocked) {
      router.replace(defaultRouteForRole(profile.role));
    }
  }, [profile, blocked, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">
        Cargando…
      </div>
    );
  }
  if (!profile) return <ProfileGate />;

  return (
    <div className="flex h-screen flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-hidden">
        {blocked ? (
          <div className="flex h-full items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-500">
            Esta sección no está disponible para tu perfil ({roleLabel(profile.role)}).
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ProfileProvider>
      <DashboardShell>{children}</DashboardShell>
    </ProfileProvider>
  );
}
