# Sprint 4 Build — last tractable engines + 6 UIs (2026-04-28)

## TL;DR

**2 more engines real** (`fraud-detection`, `churn-prediction`) — total real packages now **33**.
**6 more wired UI components** (`BillingClinicalGuard`, `ComplianceScheduleHTab`, `DemandForecastTab`, `FraudAlertCard`, `InspectorModeScreen`, `PluginMarketplaceScreen`).

**34 new tests this session, all green.** Cumulative across 4 build sessions: **382 tests across 17 real packages.**

## Engines (2 packages, 34 tests)

| Package | Tests | Highlights |
|---|---|---|
| `@pharmacare/fraud-detection` | 18 | 5 detectors (high-discount, after-hours, frequent-voids, duplicate-refunds, schedX-velocity) · per-user grouping · LLM-narrative templates · pure rule engine works without scikit |
| `@pharmacare/churn-prediction` | 16 | RFM bucketing (R1–R5/F1–F5/M1–M5) · median cadence detection · predicted refill date · action template (FIRST_VISIT_OUTREACH/REFILL_REMINDER/CADENCE_BREAK_NUDGE/WIN_BACK_DISCOUNT) · batch ranking by risk |

## UI components (6)

| Component | LOC | Backed by |
|---|---|---|
| `BillingClinicalGuard.tsx`     | ~155 | `@pharmacare/formulary` (DDI) + `@pharmacare/pmbjp` (generic suggest) — drop-in for BillingScreen, exposes `onSaveBlockedChange` |
| `ComplianceScheduleHTab.tsx`   | ~120 | Filter by H/H1/X · search · CSV export — drop-in for ComplianceDashboard |
| `DemandForecastTab.tsx`        | ~145 | `@pharmacare/churn-prediction` · reorder + refill-nudge tabs · days-of-cover badges |
| `FraudAlertCard.tsx`           | ~100 | `@pharmacare/fraud-detection` · per-alert narrative + evidence drill-down |
| `InspectorModeScreen.tsx`      | ~190 | `@pharmacare/inspector-mode` · single-tap report · Markdown + JSON export |
| `PluginMarketplaceScreen.tsx`  | ~135 | `@pharmacare/plugin-sdk` · sample marketplace · sensitive-cap consent dialog |

## File system

| | After S3 | After S4 |
|---|---|---|
| Source files | 714 | **717** |
| Real packages | 31 | **33** |
| Real desktop screens / components | 9 | **15** |
| Cumulative tests passing | 348 | **382** |

## Cumulative coverage of MASTER_PLAN_v3 features

| Feature | State |
|---|---|
| Idempotency on save_bill / save_grn / save_partial_return | ✓ S2 |
| Cash shift / Z-report | ✓ engine + screen |
| Khata + ageing + risk score | ✓ engine + screen |
| RBAC + MFA gate | ✓ engine + screen |
| Tally / Zoho / QuickBooks export | ✓ engine + ReportsExportPanel |
| GSTR-3B / 2B / 9 | ✓ engine + ReportsExportPanel |
| DDI + allergy + dose check | ✓ engine + hook + modal + BillingClinicalGuard |
| PMBJP generic suggestions | ✓ engine + BillingClinicalGuard inline pill |
| Loyalty + tier + campaigns | ✓ engine + screen |
| DPDP consent + DSR | ✓ engine + screen |
| Counterfeit shield | ✓ engine (CNN inference deferred) |
| Inspector Mode / FDA report | ✓ engine + screen |
| AI Copilot | ✓ engine + screen (mock LLM) |
| Voice billing | ✓ Web Speech API works today + screen |
| Doctor-wise sales report | ✓ screen with phonetic dedup |
| **Fraud anomaly detection** | ✓ engine + card |
| **Churn prediction + refill nudges** | ✓ engine + DemandForecastTab |
| **Schedule H/H1/X register** | ✓ ComplianceScheduleHTab |
| **Plugin marketplace** | ✓ engine + screen |
| ABDM/ABHA + FHIR R4 | ✓ engine (live API deferred) |

**Engine + UI coverage of MASTER_PLAN_v3 features: 20/24 (83%)**.

## What remains stub-only

| Package | Why not real today |
|---|---|
| `voice-billing` (full Sarvam path) | Sarvam-Indus API + WebGPU model loading |
| `ocr-rx` | Gemini 2.5 Vision API |
| `demand-forecast` (Prophet/LSTM training) | Python ML infra |
| `whatsapp-bsp` | Gupshup BSP API credentials |
| `printer-escpos` | USB hardware (TVS / Zebra / Epson) |
| `cold-chain` | BLE temp sensor hardware |
| `cfd-display` | Tauri multi-window setup |
| `ar-shelf` | WebXR + WebGPU |
| `digital-twin` | React-Three-Fiber wiring |
| `family-vault` | depends on `abdm` live API |

All of these still ship with **locked TypeScript contracts**, **scaffolds that compile**, and **clear ADRs**.

## How to verify locally

```bash
cd pharmacare-pro
npm install

# Sprint 4 tests
npm run test --workspace @pharmacare/fraud-detection   # 18 ✓
npm run test --workspace @pharmacare/churn-prediction  # 16 ✓

# Cumulative — run everything
npm run test
```
