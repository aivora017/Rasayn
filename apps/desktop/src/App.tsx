import { useState, useEffect } from "react";
import { BillingScreen } from "./components/BillingScreen.js";
import { InventoryScreen } from "./components/InventoryScreen.js";
import { GrnScreen } from "./components/GrnScreen.js";
import { ReportsScreen } from "./components/ReportsScreen.js";
import { DirectoryScreen } from "./components/DirectoryScreen.js";
import SupplierTemplateScreen from "./components/SupplierTemplateScreen.js";
import GmailInboxScreen from "./components/GmailInboxScreen.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { healthCheckRpc, dbVersionRpc } from "./lib/ipc.js";

type Mode =
  | "billing"
  | "inventory"
  | "grn"
  | "reports"
  | "directory"
  | "templates"
  | "gmail"
  | "settings";

export function App() {
  const [mode, setMode] = useState<Mode>("billing");
  const [health, setHealth] = useState<{ ok: boolean; version: string; db: number } | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F1") { e.preventDefault(); setMode("billing"); }
      if (e.key === "F2") { e.preventDefault(); setMode("inventory"); }
      if (e.key === "F4") { e.preventDefault(); setMode("grn"); }
      if (e.key === "F3") { e.preventDefault(); setMode("reports"); }
      if (e.key === "F5") { e.preventDefault(); setMode("directory"); }
      if (e.key === "F6") { e.preventDefault(); setMode("templates"); }
      if (e.key === "F7") { e.preventDefault(); setMode("gmail"); }
      if (e.key === "F8") { e.preventDefault(); setMode("settings"); }
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
      <header className="topbar">
        <div className="brand">PharmaCare Pro</div>
        <div className="shortcut"><span className="kbd">F1</span> Billing &middot; <span className="kbd">F2</span> Inventory &middot; <span className="kbd">F4</span> Receive &middot; <span className="kbd">F3</span> Reports &middot; <span className="kbd">F5</span> Directory &middot; <span className="kbd">F6</span> Templates &middot; <span className="kbd">F7</span> Gmail &middot; <span className="kbd">F8</span> Settings</div>
        <div style={{ marginLeft: "auto" }} data-testid="current-mode">{mode}</div>
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
      </main>
      <footer className="statusbar">
        <span data-testid="lan-mode">LAN Mode</span>
        <span>Vaidyanath Pharmacy &middot; Kalyan &middot; GSTIN 27ABCDE1234F1Z5</span>
        <span data-testid="health" style={{ marginLeft: "auto" }}>
          {health ? `backend v${health.version} · db@${health.db}` : "offline stub"}
        </span>
      </footer>
    </div>
  );
}
