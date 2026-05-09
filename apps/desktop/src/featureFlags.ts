// Feature flags — gates new MASTER_PLAN_v3 screens.
// Off by default in production; flip to true via env or Settings → Developer.
// Enables progressive rollout per sprint.

export interface FeatureFlags {
  // Sprint 2 — Pharmacy-OS table-stakes pack #1
  readonly cashShift:           boolean;
  readonly khata:               boolean;
  readonly doctorReport:        boolean;
  readonly loyalty:             boolean;
  readonly multiStateGstRoute:  boolean;
  // Sprint 3 — Pharmacy-OS pack #2 + clinical safety
  readonly rbac:                boolean;
  readonly ddiAlerts:           boolean;
  readonly counseling:          boolean;
  readonly stockTransfer:       boolean;
  // Sprint 4 — Compliance auto + hardware
  readonly gst3bAndRecon:       boolean;
  readonly thermalEscPos:       boolean;
  readonly gs1DataMatrix:       boolean;
  readonly dpdp:                boolean;
  readonly abdm:                boolean;
  readonly pmbjp:               boolean;
  // Phase C selling — license + auto-update (always on, gates other features)
  readonly license:            boolean;
  readonly updateChecker:      boolean;
  // CA Export (entity-aware) + onboarding + migration — always on (sellable software)
  readonly caExport:           boolean;
  readonly onboarding:         boolean;
  readonly migrationImport:    boolean;
  readonly dataExport:         boolean;
  // Sprint 5 — AI layer #1
  readonly ocrRx:               boolean;
  readonly cfdDisplay:          boolean;
  readonly copilot:             boolean;
  readonly demandForecast:      boolean;
  readonly fraudAlerts:         boolean;
  readonly inspectorMode:       boolean;
  // Phase 2 — Multi-store + Cloud
  readonly multiStore:          boolean;
  readonly coldChain:           boolean;
  // Phase 3 — Futuristic moonshots
  readonly digitalTwin:         boolean;
  readonly arShelf:             boolean;
  readonly familyVault:         boolean;
  readonly pluginMarketplace:   boolean;
  // S12 — operational depth
  readonly reorder:             boolean;
  readonly expiryDiscard:       boolean;
  readonly prescription:        boolean;
  readonly printerSettings:     boolean;
  readonly abdmConsents:        boolean;
}

const DEFAULT: FeatureFlags = {
  cashShift: false, caExport: true, onboarding: true, migrationImport: true, dataExport: true,
  license: true, updateChecker: true, khata: false, doctorReport: false, loyalty: false, multiStateGstRoute: false,
  // S28-D1: counseling flipped ON. CounselingScreen is real per S28-A1
  // (ADR-0073). The scaffold-only entry is removed from
  // SCAFFOLD_ONLY_MODES below so PILOT_BUILD no longer suppresses it.
  rbac: false, ddiAlerts: false, counseling: true, stockTransfer: false,
  gst3bAndRecon: false, thermalEscPos: false, gs1DataMatrix: false, dpdp: true, abdm: false, pmbjp: false,
  ocrRx: false, cfdDisplay: false, copilot: false, demandForecast: false, fraudAlerts: false, inspectorMode: false,
  multiStore: true, coldChain: true,
  digitalTwin: false, arShelf: false, familyVault: false, pluginMarketplace: false,
  reorder: true, expiryDiscard: true, prescription: true, printerSettings: true, abdmConsents: true,
};

const DEV_OVERRIDE: Partial<FeatureFlags> =
  typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV
    ? { /* turn on whatever you're working on locally */ }
    : {};

export const FEATURE_FLAGS: FeatureFlags = { ...DEFAULT, ...DEV_OVERRIDE };

/** Returns true if any new MASTER_PLAN_v3 mode is enabled (used by AppShell to show "Pharmacy OS Preview" nav group). */
export function anyPharmacyOsFeatureEnabled(): boolean {
  return Object.values(FEATURE_FLAGS).some(Boolean);
}
// === S26.G — PILOT_BUILD scaffold-only gate ===
//
// Originally four screens (RxScanModal, ARShelfOverlay, CounselingScreen,
// ABHAVerifyModal) shipped as 1/5 scaffolds rendering literal "coming
// online" text. In a PILOT_BUILD artifact we hide them from the sidebar +
// command palette and render UpcomingFeature instead of the scaffold body.
//
// S28-D1: "counseling" graduated out of this list — CounselingScreen is
// now a real implementation per S28-A1 (ADR-0073) and is required for the
// Schedule-H mandate at the Vaidyanath pilot. The remaining three screens
// stay scaffolded.

export const PILOT_BUILD: boolean =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { VITE_PILOT_BUILD?: string } }).env?.VITE_PILOT_BUILD !== "false";

export const SCAFFOLD_ONLY_MODES = [
  "arShelf",
  "rxScan",
  "abhaVerify",
] as const;

export function isScaffoldHidden(mode: string): boolean {
  if (!PILOT_BUILD) return false;
  return (SCAFFOLD_ONLY_MODES as readonly string[]).includes(mode);
}

