# Scaffold Complete — 2026-04-28

Master Plan v3 → repo. Every feature in the catalog has a file home.

## Verification (all green)

| Check | Result |
|---|---|
| 26 new packages — each has package.json + tsconfig + index.ts + index.test.ts + README | **26 / 26 ✓** |
| Zero-dep packages type-check via tsc 5.6.3 | **clean** (rbac, ai-copilot, pmbjp, etc.) |
| Dep packages type-check (formulary, khata, cash-shift, gst-extras, demand-forecast, churn-prediction, loyalty) with workspace symlinks | **7 / 7 clean** |
| 24 new desktop screens — each has .tsx + .test.tsx | **24 / 24 ✓** |
| 37 SQL migrations apply in sequence (0001..0037) | **37 / 37 clean** |
| 37 new ADRs (0030..0066) created | **37 / 37 ✓** |
| 9 new apps scaffolded (4 mobile + 3 web + cloud-services + visionos) | **9 / 9 ✓** |
| AppShell wired with FEATURE_FLAGS-gated preview nav group | **✓** |
| App.tsx routes 17 new modes via FEATURE_FLAGS | **✓** |
| package.json workspaces extended for apps/mobile/* + apps/web/* | **✓** |
| vitest.workspace.ts updated to include 26 new packages | **✓** |
| 30 new database tables verified after full migration chain | **✓** |

## Repo footprint changes

| | Before | After |
|---|---|---|
| Total source files (excl node_modules / dist / target) | 415 | 702 |
| Packages | 21 | 47 |
| Desktop React screens | 20 | 44 |
| Apps | 1 | 5 (+9 sub-apps under mobile/web) |
| Migrations | 22 | 37 |
| ADRs | 30 | 67 |
| Tables in shared-db | 38 | 68 |

## How to bring the scaffold to life

```bash
cd pharmacare-pro
npm install                      # picks up new workspaces
npm run typecheck                # full monorepo typecheck via turbo
npm run test                     # placeholders all .skip; will go green
npm run --workspace @pharmacare/desktop dev   # launches with all flags OFF
```

To enable a preview screen during development, edit `apps/desktop/src/featureFlags.ts`:

```ts
const DEV_OVERRIDE: Partial<FeatureFlags> =
  typeof import.meta !== "undefined" && import.meta.env?.DEV
    ? { cashShift: true, khata: true, doctorReport: true }   // ← turn these on
    : {};
```

The AppShell will surface a new "Pharmacy OS · Preview" nav group with only the enabled screens.

## Build sequence (the order of operations)

This is the order to bring scaffolds to life — each row depends on prior rows.

| Order | Phase | Sprint | What lands | Touches |
|---|---|---|---|---|
| 1 | Security + idempotency | S1 | ADR-0030 idempotency tokens · ADR-0031 crypto-at-rest impl · S01–S05 fixes · OAuth refresh | `crypto`, `commands.rs`, `oauth/google.rs` |
| 2 | Pharmacy-OS table-stakes #1 | S2 | `cash-shift` real impl + `CashShiftScreen` · `khata` real + `KhataScreen` · `tally-export` · `gst-extras` (GSTR-3B) · `DoctorReportScreen` real · multi-state GST UI in BillingScreen · ADR-0039/0040/0041 | 7 packages, 4 screens |
| 3 | Pharmacy-OS table-stakes #2 + clinical safety | S3 | `rbac` real + `RBACScreen` + MFA gate · `formulary` seeded with FDA Orange + CIMS-India + `DDIAlertModal`/`AllergyAlertModal` · `cash-shift` finalized · `ReconcileTab` finished · ADR-0034/0038 | 5 packages, 5 screens |
| 4 | Compliance auto + hardware | S4 | `gst-extras` (GSTR-3B+2A/2B+9) · `pmbjp` catalog ingest · `abdm` ABHA verify · `dpdp` consent UI · `printer-escpos` ESC/POS driver + cash drawer · GS1 DataMatrix decoder · ADR-0051/0052/0053/0056/0057 | 6 packages, 4 screens |
| 5 | AI layer #1 + visual rollout | S5 | `voice-billing` real (Whisper-Indic + Sarvam-Indus) + Alt+V overlay · `ocr-rx` real + `RxScanModal` · `cfd-display` real · `whatsapp-bsp` real · `loyalty` real + `LoyaltyScreen` · NORTH_STAR §17 sweep across all 18+screens | 5 packages, 5 screens |
| 6 | Pilot kit FINAL + Jagannath LIVE | S6 | DR drill, E2E (Playwright on MSI), pilot DOCX FINAL, Jagannath install + 14-day parallel run | infra + docs |
| 7 | Multi-store LAN | S7-S8 | `cloud-services/sync-relay` Go service · rqlite + mDNS in src-tauri · `MultiStoreScreen` · `StockTransferScreen` · ADR-0028 | cloud-services, 2 screens |
| 8 | Cloud bridge GA | S9-S10 | `cloud-services/copilot-gateway` + Postgres+RLS + NATS JetStream + Cloudflare Tunnel · ADR-0048 wiring | cloud-services |
| 9 | AI layer #2 | S11-S12 | `demand-forecast` real (Prophet+LSTM) + `DemandForecastTab` · `churn-prediction` real · `fraud-detection` real + `FraudAlertCard` · `counterfeit-shield` real (CNN + DataMatrix) · ADR-0044/0045/0046/0047 | 4 packages, 2 screens |
| 10 | Mobile apps live | S13-S14 | `apps/mobile/owner` + `cashier` + `customer` · ADR-0048 mobile copilot | 3 apps |
| 11 | Storefront + delivery | S15-S16 | `apps/web/storefront` + `apps/mobile/rider` + Shiprocket+Dunzo+WhatsApp checkout | 2 apps |
| 12 | Distributor portal + AI Copilot + Inspector Mode | S17-S18 | `apps/web/distributor-portal` · `ai-copilot` real (Cube.dev + Opus 4.7) · `inspector-mode` real + `CopilotPanel` + `InspectorModeScreen` · ADR-0048/0049 | 1 app, 2 packages, 2 screens |
| 13 | Hardening + 50-shop pilot | S19-S20 | SOC 2 Type 1 + CASA Tier-2 + external pentest | infra |
| 14 | Futuristic Pack #1 | S21-S22 | `voice-billing` customer-kiosk web app · `family-vault` real + `FamilyVaultScreen` · `counterfeit-shield` polish · ADR-0060 | 1 app, 2 packages, 1 screen |
| 15 | Futuristic Pack #2 + GA | S23-S24 | `ar-shelf` real + `ARShelfOverlay` (WebXR + WebGPU) · `digital-twin` real + `DigitalTwinScreen` · `plugin-sdk` real + `PluginMarketplaceScreen` · visionOS · biometric Schedule-X · cold-chain BLE · ADR-0050/0059/0060/0061/0062/0063/0064 | 5+ packages, 4 screens |

Each phase exits green only when (a) ADRs flip from Draft to Accepted, (b) feature flag flips on, (c) screen visual quality ≥ 4/5 per NORTH_STAR §17, (d) tests cover ≥ 80% of new code.

## Files mapping

See `SCAFFOLD_INDEX.md` for the full feature → file map (100+ rows across 8 categories).

## Tech-stack reference (April 2026 latest)

Embedded in `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` §3.

Quick reference:
- React 19.2.5 · Tauri 2.10.3 · TS 5.6.3 (will bump to 5.7) · Tailwind 4 · Vite 5/6
- Claude Opus 4.7 (frontier reasoning) · Sonnet 4.6 (computer-use, agentic)
- Sarvam-Indus 105B (Indic edge) · Whisper-Indic-v3-turbo (ASR) · Gemini 2.5 Pro Vision
- LiteLLM gateway · Cube.dev semantic layer · pgvector 0.8 · WebGPU + ONNX Runtime Web
- Postgres 17 + RLS · Redis 7 · NATS JetStream 2.10 · Cloudflare Tunnel
