"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProfileProvider, useProfile } from "@/components/ProfileProvider";
import { ProfileGate } from "@/components/ProfileGate";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { canAccess, defaultRouteForRole, roleLabel } from "@/lib/profile";

// Layout del dashboard: monta el ProfileProvider y aplica el gate de perfil.
// Sin perfil -> ProfileGate. Con perfil -> menú lateral + contenido del módulo
// (app-shell portado de Hábitat: columna en celular, fila en escritorio).
// Access control: si el rol no puede ver la ruta actual (canAccess() lo
// dice), redirigimos al default del rol. Los items del menú ya están
// filtrados, pero esto cubre URLs directas (asesor pegando /webhooks, etc).

function DashboardShell({ children }: { children: ReactNode }) {
  const { profile, ready } = useProfile();
  const pathname = usePathname();
  const router = useRouter();

  // Safari conserva el alto de layout al abrir el teclado. El área visual
  // mantiene el composer accesible, sin impedir el zoom de accesibilidad.
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || viewport.scale !== 1) return;
      document.documentElement.style.setProperty("--app-viewport-height", `${viewport.height}px`);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--app-viewport-height");
    };
  }, []);

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
    <div className="app-shell flex flex-col overflow-hidden lg:flex-row">
      <DashboardSidebar />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {blocked ? (
          <div className="flex h-full items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-500">
            Esta sección no está disponible para tu perfil ({roleLabel(profile.role)}).
          </div>
        ) : (
          // Las bandejas leen ?q= con useSearchParams, que necesita un límite
          // de Suspense para el render estático.
          <Suspense fallback={null}>{children}</Suspense>
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
