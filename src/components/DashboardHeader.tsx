"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ChevronDown,
  MessagesSquare,
  Webhook,
  LogOut,
  MessageCircle,
  Inbox,
} from "lucide-react";
import { useProfile } from "./ProfileProvider";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";
import { BrandLogo } from "./BrandLogo";
import { roleLabel } from "@/lib/profile";
import type { ProfileRole } from "@/lib/supabase/types";

// Header del dashboard: tabs de navegación + tema + perfil activo.
// Cada tab declara qué roles pueden verla. Espejo de la tabla ROLE_ACCESS
// en src/lib/profile.ts — las dos tienen que quedar alineadas.

const TABS: Array<{
  href: string;
  label: string;
  icon: typeof MessagesSquare;
  roles: ProfileRole[];
}> = [
  { href: "/conversations", label: "Testing", icon: MessagesSquare, roles: ["dev", "client"] },
  { href: "/wa", label: "WhatsApp", icon: MessageCircle, roles: ["dev", "asesor"] },
  { href: "/feedback", label: "Feedback", icon: Inbox, roles: ["dev", "client"] },
  { href: "/webhooks", label: "Webhooks", icon: Webhook, roles: ["dev"] },
];

export function DashboardHeader() {
  const { profile, changeProfile } = useProfile();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!profile) return null;

  return (
    <header className="relative z-50 flex items-center justify-between gap-2 border-b border-neutral-200/70 bg-white/80 px-4 backdrop-blur sm:px-6 dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="flex items-center gap-4 sm:gap-7">
        <Link
          href="/conversations"
          className="hidden items-center gap-2.5 py-4 text-[13px] font-medium tracking-tight-er text-neutral-900 transition hover:opacity-80 sm:flex dark:text-neutral-50"
        >
          <BrandLogo />
          Agentic&nbsp;Panel
        </Link>
        <nav className="-mb-px flex items-center">
          {TABS.filter((t) => t.roles.includes(profile.role)).map((tab) => {
            const active = pathname.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative flex items-center gap-2 px-3 py-4 text-[13px] transition sm:px-3.5 ${
                  active
                    ? "text-neutral-900 dark:text-neutral-50"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="hidden min-[380px]:inline">{tab.label}</span>
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-px h-px bg-neutral-900 dark:bg-neutral-50"
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
