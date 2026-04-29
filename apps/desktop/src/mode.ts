// Mode = which top-level screen the AppShell is showing.
// Original 11 modes (v2.0 playbook) + 22 new modes from MASTER_PLAN_v3 (2026-04-28).
// New screens are scaffold-only and gated behind the FEATURE_FLAGS toggle in
// AppShell (not visible by default until each ADR ships).

export type Mode =
  // Original (v0.1.0 baseline)
  | "dashboard"
  | "billing"
  | "inventory"
  | "grn"
  | "reports"
  | "directory"
  | "templates"
  | "gmail"
  | "settings"
  | "masters"
  | "returns"
  // Pharmacy-OS table-stakes (Sprint 2-3 from re-ranked plan)
  | "cashShift"
  | "khata"
  | "doctorReport"
  | "loyalty"
  | "counseling"
  | "rbac"
  | "stockTransfer"
  | "multiStore"
  // Compliance + AI (Sprint 4-5)
  | "complianceDashboard"
  | "demandForecast"
  | "fraudAlerts"
  | "inspectorMode"
  | "copilot"
  | "abdmConsents"
  | "dpdp"
  // IoT + Hardware (Sprint 7+)
  | "coldChain"
  // Futuristic moonshots (Phase 2+)
  | "digitalTwin"
  | "arShelf"
  | "familyVault"
  | "pluginMarketplace"
  // CA export (Pharmacy-OS table-stakes — entity-aware)
  | "caExport"
  // Onboarding wizard (first-run)
  | "onboarding"
  // Migration in / out
  | "migrationImport"
  | "dataExport"
  // Sellable software extras
  | "license"
  | "updateChecker"
  | "cfdDisplay"
  // S12 — Operational depth
  | "reorder"
  | "expiryDiscard"
  | "prescription";
