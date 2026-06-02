"use client";

import type { ReactNode } from "react";
import { ProfileProvider, useProfile } from "@/components/ProfileProvider";
import { ProfileGate } from "@/components/ProfileGate";
import { DashboardHeader } from "@/components/DashboardHeader";

// Layout del dashboard: monta el ProfileProvider y aplica el gate de perfil.
// Sin perfil -> ProfileGate. Con perfil -> header + contenido de la tab.

function DashboardShell({ children }: { children: ReactNode }) {
  const { profile, ready } = useProfile();

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
      <main className="flex-1 overflow-hidden">{children}</main>
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
