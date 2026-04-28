import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  IconButton,
  Badge,
  Button,
  ThemeToggle,
  CommandPalette,
  CommandGroup,
  CommandItem,
  useReducedMotion,
} from "@pharmacare/design-system";
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
  ShieldCheck,
  Sparkles,
  Pill,
  LayoutDashboard,
  Command as CommandIcon,
} from "lucide-react";
import type { Mode } from "../mode.js";
import type { Shop } from "../lib/ipc.js";

/**
 * North Star §11.1 — grouped navigation.
 *   Sell · Receive · Stock · Insights, plus Dashboard + Settings.
 *   All Alt+digit aliases preserved (§13.2 keyboard contract is sacred).
 */

interface AppShellProps {
  mode: Mode;
  setMode: (m: Mode) => void;
  shop: Shop | null;
  isFirstRun: boolean;
  health: { ok: boolean; version: string; db: number } | null;
  children: ReactNode;
}

interface NavItem {
  mode: Mode;
  label: string;
  icon: JSX.Element;
  shortcut: string;
}

const NAV_GROUPS: ReadonlyArray<{ title: string; items: ReadonlyArray<NavItem> }> = [
  {
    title: "Sell",
    items: [
      { mode: "billing", label: "Billing", icon: <Receipt size={16} />, shortcut: "Alt+1" },
      { mode: "returns", label: "Returns", icon: <Undo2 size={16} />, shortcut: "Alt+0" },
      { mode: "directory", label: "Directory", icon: <UsersRound size={16} />, shortcut: "Alt+5" },
    ],
  },
  {
    title: "Receive",
    items: [
      { mode: "grn", label: "GRN", icon: <PackagePlus size={16} />, shortcut: "Alt+4" },
      { mode: "gmail", label: "Gmail inbox", icon: <Mail size={16} />, shortcut: "Alt+7" },
      { mode: "templates", label: "Supplier templates", icon: <FileText size={16} />, shortcut: "Alt+6" },
    ],
  },
  {
    title: "Stock",
    items: [
      { mode: "inventory", label: "Inventory", icon: <Package size={16} />, shortcut: "Alt+2" },
      { mode: "masters", label: "Product master", icon: <Pill size={16} />, shortcut: "Alt+9" },
    ],
  },
  {
    title: "Insights",
    items: [
      { mode: "reports", label: "Reports", icon: <ChartLine size={16} />, shortcut: "Alt+3" },
    ],
  },
];

export function AppShell({ mode, setMode, shop, isFirstRun, health, children }: AppShellProps): JSX.Element {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="pc-app grid h-full" style={{ gridTemplateRows: "52px 1fr 36px" }}>
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header
        role="banner"
        className="flex items-center gap-3 border-b border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] px-4"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-[var(--pc-radius-md)] bg-[var(--pc-brand-primary)] text-white font-medium"
          >
            ℞
          </span>
          <div>
            <div className="text-[13px] font-medium leading-tight">PharmaCare Pro</div>
            <div className="text-[11px] text-[var(--pc-text-secondary)] leading-tight">
              {shop && !isFirstRun ? `${shop.name} · ${shop.gstin}` : "First-run · configure shop"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="ml-auto flex h-9 w-[320px] max-w-[40vw] items-center gap-2 rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface-2)] px-3 text-[12px] text-[var(--pc-text-tertiary)] transition-colors hover:border-[var(--pc-border-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-brand-primary)]"
          data-testid="cmdk-trigger"
          aria-label="Open command palette"
        >
          <Search size={14} aria-hidden />
          <span className="flex-1 text-left">Search products, customers, bills…</span>
          <kbd className="rounded-[var(--pc-radius-sm)] bg-[var(--pc-bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--pc-text-secondary)]">
            Ctrl K
          </kbd>
        </button>

        <span
          data-testid="current-mode"
          aria-live="polite"
          className="text-[11px] text-[var(--pc-text-tertiary)] mr-1"
        >
          {mode}
        </span>
        <ThemeToggle />

        <div
          aria-label="Owner"
          className="grid h-7 w-7 place-items-center rounded-full bg-[var(--pc-brand-primary-soft)] text-[11px] font-medium text-[var(--pc-brand-primary-hover)]"
        >
          SS
        </div>
      </header>

      {/* ── Body: nav rail + content ───────────────────────── */}
      <div className="grid min-h-0" style={{ gridTemplateColumns: "224px 1fr" }}>
        <nav
          aria-label="Primary"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] p-3"
        >
          <NavTile
            active={mode === "dashboard"}
            label="Dashboard"
            icon={<LayoutDashboard size={16} />}
            shortcut=""
            onClick={() => setMode("dashboard")}
          />
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-[0.6px] text-[var(--pc-text-tertiary)]">
                {group.title}
              </div>
              <div className="flex flex-col gap-1">
                {group.items.map((it) => (
                  <NavTile
                    key={it.mode}
                    active={mode === it.mode}
                    label={it.label}
                    icon={it.icon}
                    shortcut={it.shortcut}
                    onClick={() => setMode(it.mode)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="mt-auto">
            <NavTile
              active={mode === "settings"}
              label="Settings"
              icon={<Settings2 size={16} />}
              shortcut="Alt+8"
              onClick={() => setMode("settings")}
            />
          </div>
        </nav>

        <main
          className="min-h-0 overflow-hidden bg-[var(--pc-bg-canvas)]"
          data-testid="screen-host"
        >
          {isFirstRun && mode !== "settings" ? (
            <div
              data-testid="first-run-banner"
              role="alert"
              className="border-b border-[var(--pc-state-warning)] bg-[var(--pc-state-warning-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--pc-state-warning)]"
            >
              First-run setup required — press
              {" "}<kbd className="rounded-[var(--pc-radius-sm)] bg-[var(--pc-state-warning)] text-white px-1.5 py-0.5 text-[10px]">Alt+8</kbd>{" "}
              to open Settings (GSTIN, drug licence, address). GST invoices blocked until then.
            </div>
          ) : null}
          <motion.div
            key={mode}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 300, damping: 30, mass: 0.8 }
            }
            className="h-full overflow-auto"
          >
            {children}
          </motion.div>
        </main>
      </div>

      {/* ── Status bar ──────────────────────────────────────── */}
      <footer
        role="contentinfo"
        className="flex items-center gap-4 border-t border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] px-4 text-[11px] text-[var(--pc-text-secondary)]"
      >
        <span className="inline-flex items-center gap-1.5" data-testid="lan-mode">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--pc-state-success)]" aria-hidden />
          LAN online
        </span>
        <span data-testid="shop-summary">
          {shop && !isFirstRun ? `${shop.name} · GSTIN ${shop.gstin}` : "First-run · shop not configured"}
        </span>
        <span className="ml-auto" data-testid="health">
          {health ? `backend v${health.version} · db@${health.db}` : "offline stub"}
        </span>
      </footer>

      {/* ── Command palette ──────────────────────────────────── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}>
        <CommandGroup heading="Screens">
          <CommandItem onSelect={() => { setMode("dashboard"); setPaletteOpen(false); }}>
            <LayoutDashboard size={14} aria-hidden /> <span className="ml-2">Dashboard</span>
          </CommandItem>
          {NAV_GROUPS.flatMap((g) => g.items).map((it) => (
            <CommandItem key={it.mode} onSelect={() => { setMode(it.mode); setPaletteOpen(false); }}>
              {it.icon} <span className="ml-2">{it.label}</span>
              <span className="ml-auto text-[10px] text-[var(--pc-text-tertiary)]">{it.shortcut}</span>
            </CommandItem>
          ))}
          <CommandItem onSelect={() => { setMode("settings"); setPaletteOpen(false); }}>
            <Settings2 size={14} aria-hidden /> <span className="ml-2">Settings</span>
            <span className="ml-auto text-[10px] text-[var(--pc-text-tertiary)]">Alt+8</span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { setMode("billing"); setPaletteOpen(false); }}>
            <Receipt size={14} aria-hidden /> <span className="ml-2">New bill</span>
          </CommandItem>
          <CommandItem onSelect={() => { setMode("grn"); setPaletteOpen(false); }}>
            <PackagePlus size={14} aria-hidden /> <span className="ml-2">Receive (GRN)</span>
          </CommandItem>
          <CommandItem onSelect={() => { setMode("masters"); setPaletteOpen(false); }}>
            <Pill size={14} aria-hidden /> <span className="ml-2">Add product</span>
          </CommandItem>
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
}

function NavTile({ active, label, icon, shortcut, onClick }: NavTileProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        "flex h-8 items-center gap-2 rounded-[var(--pc-radius-md)] px-2 text-[13px] transition-colors " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-brand-primary)] " +
        (active
          ? "bg-[var(--pc-brand-primary-soft)] text-[var(--pc-brand-primary-hover)] font-medium"
          : "text-[var(--pc-text-secondary)] hover:bg-[var(--pc-bg-surface-3)] hover:text-[var(--pc-text-primary)]")
      }
    >
      <span aria-hidden className="inline-flex shrink-0">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {shortcut ? (
        <span className="text-[10px] text-[var(--pc-text-tertiary)]">{shortcut}</span>
      ) : null}
    </button>
  );
}
