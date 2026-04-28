import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Receipt,
  Package,
  ChartLine,
  PackagePlus,
  Undo2,
  UsersRound,
  FileText,
  Mail,
  Settings2,
  Pill,
  LayoutDashboard,
} from "lucide-react";
import {
  IconButton,
  ThemeToggle,
  LocaleSwitcher,
  CommandPalette,
  CommandGroup,
  CommandItem,
  useReducedMotion,
} from "@pharmacare/design-system";
import type { Mode } from "../mode.js";
import type { Shop } from "../lib/ipc.js";

interface AppShellProps {
  mode: Mode;
  setMode: (m: Mode) => void;
  shop: Shop | null;
  isFirstRun: boolean;
  health: { ok: boolean; version: string; db: number } | null;
  children: ReactNode;
}

interface NavItem { mode: Mode; label: string; icon: JSX.Element; shortcut: string }


// View Transitions wrapper — gracefully falls back where unsupported.
// Wraps a state-change in document.startViewTransition for native cross-fade
// + scale morph between screens. Browser support: Chromium 111+ (Tauri OK).
function withViewTransition(fn: () => void): void {
  const d = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  if (typeof d.startViewTransition === "function") {
    d.startViewTransition(() => fn());
  } else {
    fn();
  }
}

export function AppShell({ mode, setMode, shop, isFirstRun, health, children }: AppShellProps): JSX.Element {
  const { t } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const reduce = useReducedMotion();

  const NAV_GROUPS: ReadonlyArray<{ title: string; items: ReadonlyArray<NavItem> }> = [
    { title: t("nav.sell"), items: [
      { mode: "billing",   label: t("nav.billing"),   icon: <Receipt size={16} />,     shortcut: "Alt+1" },
      { mode: "returns",   label: t("nav.returns"),   icon: <Undo2 size={16} />,       shortcut: "Alt+0" },
      { mode: "directory", label: t("nav.directory"), icon: <UsersRound size={16} />,  shortcut: "Alt+5" },
    ]},
    { title: t("nav.receive"), items: [
      { mode: "grn",       label: t("nav.grn"),       icon: <PackagePlus size={16} />, shortcut: "Alt+4" },
      { mode: "gmail",     label: t("nav.gmail"),     icon: <Mail size={16} />,        shortcut: "Alt+7" },
      { mode: "templates", label: t("nav.templates"), icon: <FileText size={16} />,    shortcut: "Alt+6" },
    ]},
    { title: t("nav.stock"), items: [
      { mode: "inventory", label: t("nav.inventory"), icon: <Package size={16} />,     shortcut: "Alt+2" },
      { mode: "masters",   label: t("nav.masters"),   icon: <Pill size={16} />,        shortcut: "Alt+9" },
    ]},
    { title: t("nav.insights"), items: [
      { mode: "reports",   label: t("nav.reports"),   icon: <ChartLine size={16} />,   shortcut: "Alt+3" },
    ]},
  ];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="pc-app grid h-full pc-signature-gradient" style={{ gridTemplateRows: "56px 1fr 32px" }}>
      {/* ── Glass top bar ────────────────────────────────────── */}
      <header role="banner" className="pc-glass-2 z-30 flex items-center gap-3 px-4 border-b border-[var(--pc-border-subtle)]">
        <div className="flex items-center gap-2">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-[var(--pc-radius-md)] bg-[var(--pc-brand-primary)] text-white font-medium shadow-[var(--pc-elevation-1)]">℞</span>
          <div>
            <div className="text-[13px] font-medium leading-tight">{t("app.name")}</div>
            <div className="text-[11px] text-[var(--pc-text-secondary)] leading-tight">
              {shop && !isFirstRun ? `${shop.name} · ${shop.gstin}` : t("app.shopUnconfigured")}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="ml-auto flex h-9 w-[360px] max-w-[42vw] items-center gap-2 rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)] bg-[color-mix(in_oklab,var(--pc-bg-surface)_60%,transparent)] backdrop-blur px-3 text-[12px] text-[var(--pc-text-tertiary)] transition-all hover:border-[var(--pc-border-default)] hover:text-[var(--pc-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-brand-primary)]"
          data-testid="cmdk-trigger"
          aria-label="Open command palette"
        >
          <Search size={14} aria-hidden />
          <span className="flex-1 text-left truncate">{t("cmdk.placeholder")}</span>
          <kbd className="rounded-[var(--pc-radius-sm)] bg-[var(--pc-bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--pc-text-secondary)] font-mono">Ctrl K</kbd>
        </button>

        <LocaleSwitcher />
        <span data-testid="current-mode" aria-live="polite" className="text-[11px] text-[var(--pc-text-tertiary)]">{mode}</span>
        <ThemeToggle />

        <div aria-label="Owner" className="grid h-8 w-8 place-items-center rounded-full bg-[var(--pc-brand-primary)] text-[11px] font-medium text-white shadow-[var(--pc-elevation-1)]">SS</div>
      </header>

      {/* ── Body: nav rail + content ──────────────────────────── */}
      <div className="grid min-h-0 relative" style={{ gridTemplateColumns: "240px 1fr" }}>
        <nav aria-label="Primary" className="pc-glass-1 z-20 flex min-h-0 flex-col gap-4 overflow-y-auto p-3 pc-stagger">
          <NavTile
            active={mode === "dashboard"}
            label={t("nav.dashboard")}
            icon={<LayoutDashboard size={16} />}
            shortcut=""
            onClick={() => withViewTransition(() => setMode("dashboard"))}
            mode="dashboard"
            currentMode={mode}
          />
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.6px] text-[var(--pc-text-tertiary)]">{group.title}</div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((it) => (
                  <NavTile key={it.mode} active={mode === it.mode} label={it.label} icon={it.icon} shortcut={it.shortcut} onClick={() => setMode(it.mode)} mode={it.mode} currentMode={mode} />
                ))}
              </div>
            </div>
          ))}
          <div className="mt-auto">
            <NavTile active={mode === "settings"} label={t("nav.settings")} icon={<Settings2 size={16} />} shortcut="Alt+8" onClick={() => withViewTransition(() => setMode("settings"))} mode="settings" currentMode={mode} />
          </div>
        </nav>

        <main className="min-h-0 overflow-hidden" data-testid="screen-host">
          {isFirstRun && mode !== "settings" ? (
            <div data-testid="first-run-banner" role="alert" className="border-b border-[var(--pc-state-warning)] bg-[var(--pc-state-warning-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--pc-state-warning)]">
              {t("app.firstRun")}
            </div>
          ) : null}
          <motion.div
            key={mode}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
            className="h-full overflow-auto"
          >
            {children}
          </motion.div>
        </main>
      </div>

      {/* ── Status bar ──────────────────────────────────────── */}
      <footer role="contentinfo" className="pc-glass-1 z-20 flex items-center gap-4 px-4 text-[11px] text-[var(--pc-text-secondary)] border-t border-[var(--pc-border-subtle)]">
        <span className="inline-flex items-center gap-1.5" data-testid="lan-mode">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--pc-state-success)] animate-pulse" aria-hidden />
          {t("app.lanOnline")}
        </span>
        <span data-testid="shop-summary">
          {shop && !isFirstRun ? `${shop.name} · GSTIN ${shop.gstin}` : t("app.shopUnconfigured")}
        </span>
        <span className="ml-auto" data-testid="health">
          {health ? t("app.backendVersion", { v: health.version, db: health.db }) : t("app.offline")}
        </span>
      </footer>

      {/* ── Command palette ──────────────────────────────────── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} placeholder={t("cmdk.placeholder")}>
        <CommandGroup heading={t("cmdk.sectionScreens")}>
          <CommandItem onSelect={() => { withViewTransition(() => { setMode("dashboard"); setPaletteOpen(false); }); }}><LayoutDashboard size={14} aria-hidden /> <span className="ml-2">{t("nav.dashboard")}</span></CommandItem>
          {NAV_GROUPS.flatMap((g) => g.items).map((it) => (
            <CommandItem key={it.mode} onSelect={() => { setMode(it.mode); setPaletteOpen(false); }}>
              {it.icon} <span className="ml-2">{it.label}</span>
              <span className="ml-auto text-[10px] text-[var(--pc-text-tertiary)] font-mono">{it.shortcut}</span>
            </CommandItem>
          ))}
          <CommandItem onSelect={() => { withViewTransition(() => { setMode("settings"); setPaletteOpen(false); }); }}>
            <Settings2 size={14} aria-hidden /> <span className="ml-2">{t("nav.settings")}</span>
            <span className="ml-auto text-[10px] text-[var(--pc-text-tertiary)] font-mono">Alt+8</span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={t("cmdk.sectionActions")}>
          <CommandItem onSelect={() => { withViewTransition(() => { setMode("billing"); setPaletteOpen(false); }); }}><Receipt size={14} aria-hidden /> <span className="ml-2">{t("dashboard.quickNew")}</span></CommandItem>
          <CommandItem onSelect={() => { withViewTransition(() => { setMode("grn"); setPaletteOpen(false); }); }}><PackagePlus size={14} aria-hidden /> <span className="ml-2">{t("dashboard.quickReceive")}</span></CommandItem>
          <CommandItem onSelect={() => { withViewTransition(() => { setMode("masters"); setPaletteOpen(false); }); }}><Pill size={14} aria-hidden /> <span className="ml-2">{t("cmdk.addProduct")}</span></CommandItem>
        </CommandGroup>
      </CommandPalette>
    </div>
  );
}

interface NavTileProps {
  active: boolean;
  label: string;
  icon: JSX.Element;
  shortcut: string;
  onClick: () => void;
  mode: string;
  currentMode: string;
}

function NavTile({ active, label, icon, shortcut, onClick }: NavTileProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        "relative flex h-9 items-center gap-2 rounded-[var(--pc-radius-md)] px-2.5 text-[13px] transition-colors " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-brand-primary)] " +
        (active
          ? "text-[var(--pc-brand-primary-hover)] font-medium"
          : "text-[var(--pc-text-secondary)] hover:bg-[color-mix(in_oklab,var(--pc-bg-surface-3)_70%,transparent)] hover:text-[var(--pc-text-primary)]")
      }
    >
      {active ? (
        <motion.span
          layoutId="nav-indicator"
          className="absolute inset-0 -z-10 rounded-[var(--pc-radius-md)] bg-[var(--pc-brand-primary-soft)] border border-[color-mix(in_oklab,var(--pc-brand-primary)_25%,transparent)]"
          transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.7 }}
        />
      ) : null}
      <span aria-hidden className="relative inline-flex shrink-0">{icon}</span>
      <span className="relative flex-1 text-left truncate">{label}</span>
      {shortcut ? <span className="relative text-[10px] text-[var(--pc-text-tertiary)] font-mono">{shortcut}</span> : null}
    </button>
  );
}
