import { useState, useEffect } from "react";
import { ThemeProvider, ToasterProvider } from "@pharmacare/design-system";
import { AppShell } from "./components/AppShell.js";
import { DashboardScreen } from "./components/DashboardScreen.js";
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
import {
  healthCheckRpc,
  dbVersionRpc,
  shopGetRpc,
  type Shop,
} from "./lib/ipc.js";
import type { Mode } from "./mode.js";

// Alt+digit keyboard nav (ADR-0009 + ADR-0015 addendum). Now also Alt+` (backtick) → dashboard.
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

export interface AppProps {
  initialMode?: Mode;
}

export function App({ initialMode = "billing" }: AppProps = {}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [health, setHealth] = useState<{ ok: boolean; version: string; db: number } | null>(null);
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
        return;
      }
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        setMode("dashboard");
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

  // First-run: jump to Settings until shop config exists.
  useEffect(() => {
    if (isFirstRun && mode !== "settings") {
      setMode("settings");
    }
  }, [isFirstRun, mode]);

  return (
    <ThemeProvider defaultMode="system" storageKey="pc-theme">
      <ToasterProvider>
        <AppShell
        mode={mode}
        setMode={setMode}
        shop={shop}
        isFirstRun={isFirstRun}
        health={health}
      >
        {mode === "dashboard" && (
          <DashboardScreen
            shop={shop}
            onGoBilling={() => setMode("billing")}
            onGoGmail={() => setMode("gmail")}
            onGoMasters={() => setMode("masters")}
            onGoGrn={() => setMode("grn")}
            onGoReports={() => setMode("reports")}
          />
        )}
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
        </AppShell>
      </ToasterProvider>
    </ThemeProvider>
  );
}
