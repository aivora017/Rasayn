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

// MASTER_PLAN_v3 scaffold screens (Sprint 2-6 + Phase 2-3) — gated by FEATURE_FLAGS.
import CashShiftScreen           from "./components/CashShiftScreen.js";
import KhataScreen               from "./components/KhataScreen.js";
import DoctorReportScreen        from "./components/DoctorReportScreen.js";
import LoyaltyScreen             from "./components/LoyaltyScreen.js";
import CounselingScreen          from "./components/CounselingScreen.js";
import RBACScreen                from "./components/RBACScreen.js";
import StockTransferScreen       from "./components/StockTransferScreen.js";
import MultiStoreScreen          from "./components/MultiStoreScreen.js";
import DemandForecastTab         from "./components/DemandForecastTab.js";
import InspectorModeScreen       from "./components/InspectorModeScreen.js";
import CopilotPanel              from "./components/CopilotPanel.js";
import DPDPConsentScreen         from "./components/DPDPConsentScreen.js";
import ColdChainScreen           from "./components/ColdChainScreen.js";
import DigitalTwinScreen         from "./components/DigitalTwinScreen.js";
import ARShelfOverlay            from "./components/ARShelfOverlay.js";
import FamilyVaultScreen         from "./components/FamilyVaultScreen.js";
import PluginMarketplaceScreen   from "./components/PluginMarketplaceScreen.js";
import CAExportScreen           from "./components/CAExportScreen.js";
import OnboardingWizard         from "./components/OnboardingWizard.js";
import MigrationImportScreen   from "./components/MigrationImportScreen.js";
import DataExportScreen        from "./components/DataExportScreen.js";
import LicenseScreen           from "./components/LicenseScreen.js";
import UpdateCheckerScreen     from "./components/UpdateCheckerScreen.js";
import CFDDisplay              from "./components/CFDDisplay.js";
import { ReorderScreen }         from "./components/ReorderScreen.js";
import { ExpiryDiscardScreen }   from "./components/ExpiryDiscardScreen.js";
import { PrescriptionScreen }    from "./components/PrescriptionScreen.js";
import PrinterSettingsScreen     from "./components/PrinterSettingsScreen.js";

import {
  healthCheckRpc,
  dbVersionRpc,
  shopGetRpc,
  type Shop,
} from "./lib/ipc.js";
import type { Mode } from "./mode.js";
import { FEATURE_FLAGS } from "./featureFlags.js";

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
        {/* ── Original (v0.1.0) screens ───────────────────────────────── */}
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

        {/* ── MASTER_PLAN_v3 scaffold screens (gated) ─────────────────── */}
        {mode === "cashShift"          && FEATURE_FLAGS.cashShift          && <CashShiftScreen />}
        {mode === "khata"              && FEATURE_FLAGS.khata              && <KhataScreen />}
        {mode === "doctorReport"       && FEATURE_FLAGS.doctorReport       && <DoctorReportScreen />}
        {mode === "loyalty"            && FEATURE_FLAGS.loyalty            && <LoyaltyScreen />}
        {mode === "counseling"         && FEATURE_FLAGS.counseling         && <CounselingScreen />}
        {mode === "rbac"               && FEATURE_FLAGS.rbac               && <RBACScreen />}
        {mode === "stockTransfer"      && FEATURE_FLAGS.stockTransfer      && <StockTransferScreen />}
        {mode === "multiStore"         && FEATURE_FLAGS.multiStore         && <MultiStoreScreen />}
        {mode === "demandForecast"     && FEATURE_FLAGS.demandForecast     && <DemandForecastTab />}
        {mode === "inspectorMode"      && FEATURE_FLAGS.inspectorMode      && <InspectorModeScreen />}
        {mode === "copilot"            && FEATURE_FLAGS.copilot            && <CopilotPanel />}
        {mode === "dpdp"               && FEATURE_FLAGS.dpdp               && <DPDPConsentScreen />}
        {mode === "coldChain"          && FEATURE_FLAGS.coldChain          && <ColdChainScreen />}
        {mode === "digitalTwin"        && FEATURE_FLAGS.digitalTwin        && <DigitalTwinScreen />}
        {mode === "arShelf"            && FEATURE_FLAGS.arShelf            && <ARShelfOverlay />}
        {mode === "familyVault"        && FEATURE_FLAGS.familyVault        && <FamilyVaultScreen />}
        {mode === "pluginMarketplace"  && FEATURE_FLAGS.pluginMarketplace  && <PluginMarketplaceScreen />}
        {mode === "caExport"           && FEATURE_FLAGS.caExport           && <CAExportScreen />}
        {mode === "onboarding"         && FEATURE_FLAGS.onboarding         && <OnboardingWizard />}
        {mode === "migrationImport"    && FEATURE_FLAGS.migrationImport    && <MigrationImportScreen />}
        {mode === "dataExport"         && FEATURE_FLAGS.dataExport         && <DataExportScreen />}
        {mode === "license"            && FEATURE_FLAGS.license            && <LicenseScreen />}
        {mode === "updateChecker"      && FEATURE_FLAGS.updateChecker      && <UpdateCheckerScreen />}
        {mode === "cfdDisplay"         && FEATURE_FLAGS.cfdDisplay         && <CFDDisplay />}
        {mode === "reorder"            && FEATURE_FLAGS.reorder            && <ReorderScreen />}
        {mode === "expiryDiscard"      && FEATURE_FLAGS.expiryDiscard      && <ExpiryDiscardScreen />}
        {mode === "prescription"       && FEATURE_FLAGS.prescription       && <PrescriptionScreen />}
        {mode === "printerSettings"    && FEATURE_FLAGS.printerSettings    && <PrinterSettingsScreen />}
        </AppShell>
      </ToasterProvider>
    </ThemeProvider>
  );
}
