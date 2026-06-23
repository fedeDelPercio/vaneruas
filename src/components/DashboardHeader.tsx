"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  MessagesSquare,
  MessageCircle,
  LogOut,
  Inbox,
  Receipt,
  BarChart3,
  Flag,
  Award,
  UserPlus,
  CalendarDays,
} from "lucide-react";
import { useProfile } from "./ProfileProvider";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";
import { BrandLogo } from "./BrandLogo";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { roleLabel } from "@/lib/profile";
import type { ProfileRole } from "@/lib/supabase/types";
import type { ModuleCounts } from "@/app/api/counts/route";

// Header del dashboard: tabs de navegación + tema + perfil activo.
// Cada tab declara qué roles pueden verla. Espejo de la tabla ROLE_ACCESS
// en src/lib/profile.ts — las dos tienen que quedar alineadas.

const TABS: Array<{
  href: string;
  label: string;
  icon: typeof MessagesSquare;
  roles: ProfileRole[];
}> = [
  { href: "/conversations", label: "Testing", icon: MessagesSquare, roles: ["dev"] },
  { href: "/wa", label: "WhatsApp", icon: MessageCircle, roles: ["dev", "client", "asesor"] },
  { href: "/feedback", label: "Feedback", icon: Inbox, roles: ["dev"] },
  { href: "/payments", label: "Aprobaciones", icon: Receipt, roles: ["dev", "client", "asesor"] },
  { href: "/interventions", label: "Derivaciones", icon: Flag, roles: ["dev", "client", "asesor"] },
  { href: "/certificados", label: "Certificados", icon: Award, roles: ["dev", "client", "asesor"] },
  { href: "/agendar", label: "Agendar", icon: UserPlus, roles: ["dev", "client", "asesor"] },
  { href: "/events", label: "Eventos", icon: CalendarDays, roles: ["dev", "client", "asesor"] },
  { href: "/metrics", label: "Métricas", icon: BarChart3, roles: ["dev", "client", "asesor"] },
  // Oculto por ahora (el módulo sigue vivo, solo se sacó el tab del nav).
  // Para reactivar: re-importar el ícono de lucide y descomentar la línea.
  //   { href: "/webhooks", label: "Webhooks", icon: Webhook, roles: ["dev"] },
];

export function DashboardHeader() {
  const { profile, changeProfile } = useProfile();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [counts, setCounts] = useState<ModuleCounts>({
    payments: 0,
    interventions: 0,
    certificados: 0,
    agendar: 0,
  });

  const loadCounts = useCallback(async () => {
    try {
      const r = await fetch("/api/counts", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as ModuleCounts;
      setCounts({
        payments: j.payments ?? 0,
        interventions: j.interventions ?? 0,
        certificados: j.certificados ?? 0,
        agendar: j.agendar ?? 0,
      });
    } catch {
      // El badge es informativo: si falla el conteo, no rompemos el header.
    }
  }, []);

  // Conteo inicial + refresco en vivo cuando cambian comprobantes o derivaciones.
  useEffect(() => {
    if (!profile) return;
    void loadCounts();
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("module-counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_validations" },
        () => void loadCounts(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_notifications" },
        () => void loadCounts(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => void loadCounts(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile, loadCounts]);

  const countByHref: Record<string, number> = {
    "/payments": counts.payments,
    "/interventions": counts.interventions,
    "/certificados": counts.certificados,
    "/agendar": counts.agendar,
  };

  if (!profile) return null;

  return (
    <header className="relative z-50 flex items-center justify-between gap-1 border-b border-neutral-200/70 bg-white/80 px-3 backdrop-blur sm:gap-2 sm:px-6 dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="flex min-w-0 items-center gap-4 sm:gap-7">
        <Link
          href="/conversations"
          className="hidden items-center gap-2.5 py-4 text-[13px] font-medium tracking-tight-er text-neutral-900 transition hover:opacity-80 sm:flex dark:text-neutral-50"
        >
          <BrandLogo />
          Agentic&nbsp;Panel
        </Link>
        {/* Mobile: solo íconos. El nav contiene su propio scroll (sin barra) por
            si un rol tiene muchos tabs en una pantalla muy chica, así nunca
            desborda la página. En el caso normal (cliente, 6 tabs) no scrollea. */}
        <nav className="-mb-px flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.filter((t) => t.roles.includes(profile.role)).map((tab) => {
            const active = pathname.startsWith(tab.href);
            const Icon = tab.icon;
            const count = countByHref[tab.href] ?? 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative flex items-center gap-1 px-1.5 py-4 text-[13px] transition sm:gap-2 sm:px-3.5 ${
                  active
                    ? "text-neutral-900 dark:text-neutral-50"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${active ? "text-gold" : ""}`}
                  strokeWidth={1.75}
                />
                {/* Mobile: solo ícono (el título de cada página dice la sección).
                    Desktop (sm+): ícono + label. Así el nav no desborda en mobile. */}
                <span className="hidden sm:inline">{tab.label}</span>
                {count > 0 && (
                  <span
                    aria-label={`${count} pendientes`}
                    className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 font-mono text-[10px] font-semibold leading-none text-black"
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-gold to-gold-start"
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg p-1 pr-2 text-[13px] transition hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            <Avatar name={profile.name} size="sm" />
            <span className="hidden text-neutral-700 sm:block dark:text-neutral-200">
              {profile.name}
            </span>
            <ChevronDown className="h-3 w-3 text-neutral-400" strokeWidth={2} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[55]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-[60] mt-2 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-soft-dark">
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <Avatar name={profile.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                      {profile.name}
                    </p>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
                      {roleLabel(profile.role)}
                    </p>
                  </div>
                </div>
                <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
                <button
                  onClick={changeProfile}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-neutral-600 transition hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Cambiar perfil
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
