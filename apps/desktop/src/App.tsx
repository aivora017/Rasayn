import { useState, useEffect } from "react";
import { BillingScreen } from "./components/BillingScreen.js";
import { InventoryScreen } from "./components/InventoryScreen.js";
import { GrnScreen } from "./components/GrnScreen.js";
import { ReportsScreen } from "./components/ReportsScreen.js";
import { DirectoryScreen } from "./components/DirectoryScreen.js";
import SupplierTemplateScreen from "./components/SupplierTemplateScreen.js";
import GmailInboxScreen from "./components/GmailInboxScreen.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { ProductMasterScreen } from "./components/ProductMasterScreen.js";
import { ReturnsScreen } from "./components/ReturnsScreen.js";
import { healthCheckRpc, dbVersionRpc, shopGetRpc, type Shop } from "./lib/ipc.js";

type Mode =
  | "billing"
  | "inventory"
  | "grn"
  | "reports"
  | "directory"
  | "templates"
  | "gmail"
  | "settings"
  | "masters"
  | "returns";

// Nav key map — Alt+digit per ADR 0009 (A5).
// Plain F-keys are reserved for screen-contextual actions (e.g., BillingScreen F1/F2/F3/F4/F6/F10).
// Alt+digit does not collide with billing's plain F-keys and does not interfere with the OS/browser
// global shortcuts on Chrome (dev) or Tauri (prod).
// Alt+0 added for Returns (A10) — ADR 0015 addendum: original draft said Alt+5 but that slot
// was already taken by Directory; moved to Alt+0 (the only free digit).
const NAV_BY_DIGIT: Record<string, Mode> = {
  "1": "billing",
  "2": "inventory",
  "3": "reports",
  "4": "grn",
  "5": "directory",
  "6": "templates",
  "7": "gmail",
  "8": "settings",
  "9": "masters",
  "0": "returns",
};

export function App() {
  const [mode, setMode] = useState<Mode>("billing");
  const [health, setHealth] = useState<{ ok: boolean; version: string; db: number } | null>(null);
  // Own-shop ship-readiness: surface a global onboarding banner until the
  // placeholder shop_local row is replaced with real owner data.
  const [shop, setShop] = useState<Shop | null>(null);
  const PLACEHOLDER_GSTIN = "00AAAAA0000A0Z0";
  const PLACEHOLDER_LICENSE = "PENDING";
  const isFirstRun =
    shop !== null &&
    (shop.gstin === PLACEHOLDER_GSTIN || shop.retailLicense === PLACEHOLDER_LICENSE);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const next = NAV_BY_DIGIT[e.key];
      if (next) {
        e.preventDefault();
        setMode(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [h, v] = await Promise.all([healthCheckRpc(), dbVersionRpc()]);
        setHealth({ ok: h.ok, version: h.version, db: v });
      } catch {
        setHealth(null);
      }
    })();
  }, []);

  // Load shop on mount; refresh after Settings save.
  useEffect(() => {
    (async () => {
      try {
        const s = await shopGetRpc("shop_local");
        setShop(s);
      } catch {
        setShop(null);
      }
    })();
  }, [mode]);

  // Auto-jump to Settings on first run so a fresh-install owner sees the
  // shop config screen before being dropped on BillingScreen.
  useEffect(() => {
    if (isFirstRun && mode === "billing") {
      setMode("settings");
    }
  }, [isFirstRun, mode]);

  return (
    <div className="app">
      <header className="topbar" role="banner">
        <div className="brand">PharmaCare Pro</div>
        <nav className="shortcut" aria-label="Screen navigation">
          <span className="kbd">Alt+1</span> Billing &middot;{" "}
          <span className="kbd">Alt+2</span> Inventory &middot;{" "}
          <span className="kbd">Alt+3</span> Reports &middot;{" "}
          <span className="kbd">Alt+4</span> Receive &middot;{" "}
          <span className="kbd">Alt+5</span> Directory &middot;{" "}
          <span className="kbd">Alt+6</span> Templates &middot;{" "}
          <span className="kbd">Alt+7</span> Gmail &middot;{" "}
          <span className="kbd">Alt+8</span> Settings &middot;{" "}
          <span className="kbd">Alt+9</span> Masters &middot;{" "}
          <span className="kbd">Alt+0</span> Returns
        </nav>
        <div style={{ marginLeft: "auto" }} data-testid="current-mode" aria-live="polite">{mode}</div>
      </header>
      {isFirstRun && mode !== "settings" && (
        <div
          data-testid="first-run-banner"
          role="alert"
          style={{
            background: "#FEF3C7",
            color: "#7C2D12",
            padding: "10px 16px",
            borderBottom: "2px solid #B45309",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          First-run setup required — press{" "}
          <span className="kbd" style={{ background: "#7C2D12", color: "#fff", padding: "2px 6px", borderRadius: 3 }}>Alt+8</span>{" "}
          to open Settings and enter your shop details (GSTIN, drug licence, address). GST invoices are blocked until this is complete.
        </div>
      )}
      <main>
        {mode === "billing" && <BillingScreen />}
        {mode === "inventory" && <InventoryScreen />}
        {mode === "grn" && <GrnScreen />}
        {mode === "reports" && <ReportsScreen />}
        {mode === "directory" && <DirectoryScreen />}
        {mode === "templates" && <SupplierTemplateScreen />}
        {mode === "gmail" && <GmailInboxScreen onGoToGrn={() => setMode("grn")} />}
        {mode === "settings" && <SettingsScreen />}
        {mode === "masters" && <ProductMasterScreen />}
        {mode === "returns" && <ReturnsScreen />}
      </main>
      <footer className="statusbar" role="contentinfo">
        <span data-testid="lan-mode">LAN Mode</span>
        <span data-testid="shop-summary">
          {shop && !isFirstRun
            ? `${shop.name} · GSTIN ${shop.gstin}`
            : "First-run · shop not configured"}
        </span>
        <span data-testid="health" style={{ marginLeft: "auto" }}>
          {health ? `backend v${health.version} · db@${health.db}` : "offline stub"}
        </span>
      </footer>
    </div>
  );
}
