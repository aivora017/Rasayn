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
import { healthCheckRpc, dbVersionRpc } from "./lib/ipc.js";

type Mode =
  | "billing"
  | "inventory"
  | "grn"
  | "reports"
  | "directory"
  | "templates"
  | "gmail"
  | "settings"
  | "masters";

// Nav key map — Alt+digit per ADR 0009 (A5).
// Plain F-keys are reserved for screen-contextual actions (e.g., BillingScreen F1/F2/F3/F4/F6/F10).
// Alt+digit does not collide with billing's plain F-keys and does not interfere with the OS/browser
// global shortcuts on Chrome (dev) or Tauri (prod).
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
};

export function App() {
  const [mode, setMode] = useState<Mode>("billing");
  const [health, setHealth] = useState<{ ok: boolean; version: string; db: number } | null>(null);

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
          <span className="kbd">Alt+9</span> Masters
        </nav>
        <div style={{ marginLeft: "auto" }} data-testid="current-mode" aria-live="polite">{mode}</div>
      </header>
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
      </main>
      <footer className="statusbar" role="contentinfo">
        <span data-testid="lan-mode">LAN Mode</span>
        <span>Vaidyanath Pharmacy &middot; Kalyan &middot; GSTIN 27ABCDE1234F1Z5</span>
        <span data-testid="health" style={{ marginLeft: "auto" }}>
          {health ? `backend v${health.version} · db@${health.db}` : "offline stub"}
        </span>
      </footer>
    </div>
  );
}
