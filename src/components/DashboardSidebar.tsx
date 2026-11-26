"use client";

import toast from "react-hot-toast";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Award,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  Flag,
  Inbox,
  LogOut,
  Users,
  Menu,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  UserPlus,
  X,
} from "lucide-react";
import { useProfile } from "./ProfileProvider";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";
import { AgentModeToggle } from "./AgentModeToggle";
import { FeedbackButton } from "./feedback/FeedbackButton";
import { BrandLogo } from "./BrandLogo";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { canAccess, defaultRouteForRole, roleLabel } from "@/lib/profile";
import type { ModuleCounts } from "@/app/api/counts/route";

// Menú lateral del dashboard, portado de Hábitat (DashboardSidebar): en
// escritorio (lg+) es una columna fija que se puede contraer a solo íconos
// (preferencia por perfil en localStorage); en celular/tablet es una barra
// superior con un botón que abre el menú como drawer (<dialog>).
//
// Los permisos salen de ROLE_ACCESS (src/lib/profile.ts) vía canAccess(): un
// item solo se muestra si el rol puede entrar a su ruta. Revisión agrupa
// Aprobaciones y Derivaciones como sub-opciones.

type Item = {
  href: string;
  label: string;
  icon: typeof MessageCircle;
  /** Sub-opciones (solo un nivel). */
  children?: Item[];
};

const ITEMS: Item[] = [
  { href: "/wa", label: "WhatsApp", icon: MessageCircle },
  {
    href: "/revision",
    label: "Revisión",
    icon: ClipboardCheck,
    children: [
      { href: "/payments", label: "Aprobaciones", icon: Receipt },
      { href: "/interventions", label: "Derivaciones", icon: Flag },
    ],
  },
  { href: "/certificados", label: "Certificados", icon: Award },
  { href: "/agendar", label: "Agendar", icon: UserPlus },
  { href: "/events", label: "Eventos", icon: CalendarDays },
  { href: "/metrics", label: "Métricas", icon: BarChart3 },
];

// Herramientas internas: ROLE_ACCESS las deja solo para dev.
const DEV_ITEMS: Item[] = [
  { href: "/conversations", label: "Testing", icon: MessagesSquare },
  { href: "/feedback", label: "Feedback", icon: Inbox },
];

const REVISION_PATHS = ["/revision", "/payments", "/interventions"];

const DESKTOP_QUERY = "(min-width: 1024px)";

const iconButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-500 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-gold/60 lg:h-8 lg:w-8 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function CountBadge({ count, compact }: { count: number; compact: boolean }) {
  if (count <= 0) return null;
  if (compact) {
    return (
      <span
        aria-label={`${count} pendientes`}
        className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold"
      />
    );
  }
  return (
    <span
      aria-label={`${count} pendientes`}
      className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 font-mono text-[10px] font-medium leading-none text-black"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function DashboardSidebar() {
  const { profile, changeProfile } = useProfile();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("No se pudo cerrar la sesión");
      changeProfile();
      window.location.replace("/login");
    } catch {
      toast.error("No se pudo cerrar la sesión");
      setLoggingOut(false);
    }
  }

  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Los controles con estado propio (borrador de feedback, confirmación del
  // modo IA) se montan una sola vez: en el menú (escritorio) o en la barra
  // superior (celular).
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const preferenceKey = profile ? `atp.sidebar.${profile.id}` : null;

  const [counts, setCounts] = useState<ModuleCounts>({
    payments: 0,
    interventions: 0,
    certificados: 0,
    agendar: 0,
  });

  // Revisión se abre sola cuando estás en ella o en una sub-opción; fuera de
  // ahí se puede abrir a mano con el chevron.
  const inRevision = REVISION_PATHS.some((href) => matches(pathname, href));
  const [groupOpen, setGroupOpen] = useState(inRevision);
  useEffect(() => {
    if (inRevision) setGroupOpen(true);
  }, [inRevision]);

  useEffect(() => {
    try {
      setCollapsed(!!preferenceKey && localStorage.getItem(preferenceKey) === "collapsed");
    } catch {
      // La navegación funciona sin almacenamiento local.
    }
  }, [preferenceKey]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (mobileOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [mobileOpen]);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      setDesktop(mq.matches);
      if (mq.matches) setMobileOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
      // El badge es informativo: si falla el conteo, no rompemos el menú.
    }
  }, []);

  // Conteo inicial + refresco en vivo cuando cambian comprobantes o derivaciones.
  useEffect(() => {
    if (!profile) return;
    void loadCounts();
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("module-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_validations" }, () => void loadCounts())
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_notifications" }, () => void loadCounts())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void loadCounts())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile, loadCounts]);

  if (!profile) return null;
  const role = profile.role;

  // Revisión comparte el contador de Aprobaciones (es la misma cola).
  const countByHref: Record<string, number> = {
    "/interventions": counts.interventions,
    "/certificados": counts.certificados,
    "/agendar": counts.agendar,
  };

  const visible = (list: Item[]) =>
    list
      .filter((item) => canAccess(role, item.href))
      .map((item) => ({ ...item, children: item.children?.filter((c) => canAccess(role, c.href)) }));
  const items = visible(ITEMS);
  const devItems = visible(DEV_ITEMS);

  const flat = [...items, ...devItems].flatMap((i) => [i, ...(i.children ?? [])]);
  // La ruta más específica gana (como en Hábitat).
  const active = flat
    .filter((i) => matches(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const home = defaultRouteForRole(role);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      if (preferenceKey) localStorage.setItem(preferenceKey, next ? "collapsed" : "expanded");
    } catch {
      // Se conserva durante la sesión.
    }
  }

  function link(item: Item, compact: boolean, opts: { sub?: boolean; groupActive?: boolean } = {}) {
    const selected = active?.href === item.href;
    // El padre de un grupo se marca (sin fondo) cuando la activa es una sub-opción.
    const highlighted = selected || opts.groupActive;
    const Icon = item.icon;
    const count = countByHref[item.href] ?? 0;
    return (
      <Link
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-current={selected ? "page" : undefined}
        title={compact ? item.label : undefined}
        className={`relative flex min-h-11 min-w-0 flex-1 items-center rounded-md text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/60 lg:min-h-9 ${
          compact ? "justify-center" : opts.sub ? "gap-2.5 pl-9 pr-3" : "gap-3 px-3"
        } ${
          selected
            ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800/70 dark:text-neutral-50"
            : highlighted
              ? "font-medium text-neutral-900 hover:bg-neutral-100/70 dark:text-neutral-50 dark:hover:bg-neutral-900"
              : "text-neutral-600 hover:bg-neutral-100/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        }`}
      >
        {selected && (
          <span
            aria-hidden
            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gradient-to-b from-gold-start to-gold"
          />
        )}
        <Icon
          aria-hidden
          className={`shrink-0 ${opts.sub ? "h-3.5 w-3.5" : "h-4 w-4"} ${highlighted ? "text-gold-fg dark:text-gold" : ""}`}
          strokeWidth={1.75}
        />
        <span className={compact ? "sr-only" : "truncate"}>{item.label}</span>
        <CountBadge count={count} compact={compact} />
      </Link>
    );
  }

  function renderItem(item: Item, compact: boolean) {
    const children = item.children ?? [];
    if (children.length === 0) return <div key={item.href}>{link(item, compact)}</div>;
    const groupActive = children.some((c) => active?.href === c.href);
    const open = groupOpen || compact;
    return (
      <div key={item.href}>
        <div className="flex items-center gap-0.5">
          {link(item, compact, { groupActive })}
          {!compact && (
            <button
              type="button"
              onClick={() => setGroupOpen((v) => !v)}
              aria-label={groupOpen ? `Contraer ${item.label}` : `Expandir ${item.label}`}
              aria-expanded={groupOpen}
              className={iconButton}
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${groupOpen ? "" : "-rotate-90"}`}
                strokeWidth={1.75}
              />
            </button>
          )}
        </div>
        {open && (
          <div
            className={`mt-1 space-y-1 ${compact ? "border-t border-neutral-200 pt-1 dark:border-neutral-800" : ""}`}
          >
            {children.map((c) => (
              <div key={c.href} className="flex">
                {link(c, compact, { sub: true })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function navigation(compact: boolean, mobile: boolean) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* Cabecera como la de Hábitat: logo arriba con aire arriba y a la
            izquierda; contraído, el monograma. */}
        <div className={`flex h-24 shrink-0 items-center pt-3 ${compact ? "justify-center px-1" : "justify-between pl-7 pr-5"}`}>
          <Link
            href={home}
            onClick={() => setMobileOpen(false)}
            aria-label="Vanesa Rúas · Inicio"
            title={compact ? "Vanesa Rúas Formación Profesional" : undefined}
            className="rounded-sm outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            <BrandLogo variant={compact ? "compact" : "sidebar"} />
          </Link>
          {mobile && (
            <button type="button" autoFocus aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} className={iconButton}>
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
        </div>

        <nav
          aria-label="Navegación principal"
          className={`scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto pb-4 ${compact ? "px-2" : "px-3"}`}
        >
          {items.map((item) => renderItem(item, compact))}
          {devItems.length > 0 && (
            <>
              <div className={`pb-1 pt-4 ${compact ? "border-b border-neutral-200 dark:border-neutral-800" : "px-3"}`}>
                {!compact && (
                  <p className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    Desarrollo
                  </p>
                )}
              </div>
              {devItems.map((item) => renderItem(item, compact))}
            </>
          )}
        </nav>

        <div className={`shrink-0 border-t border-neutral-200 py-3 dark:border-neutral-800 ${compact ? "px-2" : "px-3"}`}>
          {/* Pie: el interruptor de la IA solo, arriba; después el perfil y
              una fila de botones-ícono parejos (feedback, tema, contraer,
              cerrar sesión). En celular el interruptor y el feedback viven en
              la barra superior. */}
          {!mobile && desktop && (
            <div className={`mb-2 flex ${compact ? "justify-center" : ""}`}>
              <AgentModeToggle placement="up" compact={compact} />
            </div>
          )}
          <div className={`flex items-center ${compact ? "flex-col gap-2" : "gap-2 px-1"}`}>
            <Avatar name={profile!.name} size="sm" />
            {!compact && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-neutral-900 dark:text-neutral-100" title={profile!.name}>
                  {profile!.name}
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">{roleLabel(profile!.role)}</p>
              </div>
            )}
          </div>
          <div
            role="toolbar"
            aria-label="Acciones del panel"
            className={`mt-3 flex items-center border-t border-neutral-200 pt-2 dark:border-neutral-800 ${
              compact ? "flex-col gap-1" : "justify-between"
            }`}
          >
            {!mobile && desktop && <FeedbackButton />}
            <ThemeToggle />
            {!mobile && (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
                title={collapsed ? "Expandir menú" : "Contraer menú"}
                aria-expanded={!collapsed}
                className={iconButton}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            )}
            <button type="button" onClick={changeProfile} aria-label="Cambiar de perfil" title="Cambiar de perfil" className={iconButton}>
              <Users className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => void logout()} disabled={loggingOut} aria-label="Cerrar sesión" title="Cerrar sesión" className={iconButton}>
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-2 lg:hidden dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          aria-label="Abrir menú principal"
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
          aria-controls="dashboard-mobile-menu"
          onClick={() => setMobileOpen(true)}
          className={`${iconButton} relative`}
        >
          <Menu className="h-4 w-4" strokeWidth={1.75} />
          {counts.interventions > 0 && (
            <span aria-hidden className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-gold" />
          )}
        </button>
        <Link
          href={home}
          aria-label="Vanesa Rúas · Inicio"
          className="flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <BrandLogo variant="topbar" />
        </Link>
        <span className="min-w-0 flex-1 truncate border-l border-neutral-200 pl-3 text-[12px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          {active?.label ?? "Panel"}
        </span>
        {!desktop && (
          <div className="flex shrink-0 items-center gap-0.5">
            <AgentModeToggle />
            <FeedbackButton />
          </div>
        )}
      </header>
      <aside
        aria-label="Menú lateral"
        className={`hidden h-full shrink-0 border-r border-neutral-200 bg-neutral-50/60 lg:block dark:border-neutral-800 dark:bg-neutral-950 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        {navigation(collapsed, false)}
      </aside>
      <dialog
        ref={dialog}
        id="dashboard-mobile-menu"
        aria-label="Menú principal"
        onCancel={(event) => {
          event.preventDefault();
          setMobileOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && event.clientX > event.currentTarget.getBoundingClientRect().right)
            setMobileOpen(false);
        }}
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-neutral-200 bg-white p-0 text-neutral-900 backdrop:bg-neutral-950/40 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50"
      >
        {navigation(false, true)}
      </dialog>
    </>
  );
}
