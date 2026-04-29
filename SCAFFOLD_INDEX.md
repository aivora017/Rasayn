# Scaffold Index — Master Plan v3 → File Layout

Generated 2026-04-28. Single source of truth mapping every feature in `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` to its scaffolded location. Status legend: `S` = stub created · `P` = partial impl · `R` = real impl · `-` = not yet scaffolded.

## A. Core POS / Billing

| #   | Feature | Package(s) | Screen / Component | Migration | ADR | Status |
|-----|---------|------------|--------------------|-----------|-----|--------|
| A1  | Sub-2s bill | `bill-repo`, `gst-engine`         | `BillingScreen.tsx`            | 0001     | 0010 | R |
| A2  | F-key + ⌘K palette | `design-system`            | `BillingScreen.tsx`, `AppShell.tsx` | -    | 0009 | R |
| A3  | Voice billing (Hi/Mr/Gu/Ta) | `voice-billing` | `VoiceBillingOverlay.tsx`      | 0027     | 0042 | S |
| A4  | Barcode + GS1 DataMatrix | `printer-escpos`, `search-repo` | `ProductSearch.tsx`        | -        | 0057 | S |
| A5  | Multi-payment tender split | `bill-repo`              | `PaymentModal.tsx`             | 0010     | 0012 | R |
| A6  | Round-off ±50p auto | `gst-engine`                    | `PaymentModal.tsx`             | -        | 0007 | R |
| A7  | Multi-state GST routing | `gst-engine`, `gst-extras`  | `BillingScreen.tsx`            | -        | 0007 | P |
| A8  | Khata (credit) ledger | `khata`                      | `KhataScreen.tsx`              | 0024     | 0040 | S |
| A9  | Loyalty + dynamic discount | `loyalty`                | `LoyaltyScreen.tsx`            | 0034     | 0054 | S |
| A10 | SMS + WhatsApp invoice | `whatsapp-bsp`               | (in BillingScreen save flow)   | -        | 0055 | S |
| A11 | Customer-facing display | `cfd-display`               | `CFDDisplay.tsx`               | -        | 0058 | S |
| A12 | Bill-draft persistence | (apps/desktop lib)           | `BillingScreen.tsx` localStg   | -        | 0035 | S |
| A13 | Dual-printer ESC/POS + A4 + dot-matrix | `printer-escpos` `invoice-print` | -      | -        | 0056 | S |
| A14 | Smart receipt QR (ABHA + side-effects) | `abdm`, `ai-copilot`     | `PaymentModal.tsx`             | 0032     | 0052 | S |
| A15 | Patient counseling record | (apps/desktop)             | `CounselingScreen.tsx`         | 0035     | 0011 | S |
| A16 | DDI + allergy + dose check | `formulary`               | `DDIAlertModal.tsx`, `AllergyAlertModal.tsx` | 0026 | 0034 | S |

## B. Inventory + Supply Chain

| #   | Feature | Package(s) | Screen | Migration | ADR | Status |
|-----|---------|------------|--------|-----------|-----|--------|
| B1  | FEFO trigger + ledger | `batch-repo`, `shared-db`   | `InventoryScreen.tsx` | 0007 | 0005 | R |
| B2  | Batch expiry alerts (90/60/30/7) | `batch-repo`         | `InventoryScreen.tsx` | 0007 | 0005 | R |
| B3  | Reorder-point engine + auto-PO | `demand-forecast`      | `DemandForecastTab.tsx` | 0028 | 0044 | S |
| B4  | 3-way PO/GRN/Invoice match | `grn-repo`              | `GrnScreen.tsx` | 0003 | 0010 | P |
| B5  | Rack-wise location tracking | (shared-db)            | `InventoryScreen.tsx` | 0028 | 0044 | S |
| B6  | Dead-stock customer-match offload | `churn-prediction`, `whatsapp-bsp` | `InventoryScreen.tsx` | - | 0046 | S |
| B7  | Multi-store stock transfer | (apps/desktop, cloud)  | `StockTransferScreen.tsx` | - | 0028 | S |
| B8  | Cycle counting (top-20 monthly) | `stock-reconcile`      | `ReconcileTab.tsx` | 0015 | 0016 | P |
| B9  | X1 Gmail bridge | `gmail-grn-bridge`, `gmail-inbox` | `GmailInboxScreen.tsx` | 0005 | 0001 | R |
| B10 | X3 Photo-bill OCR → GRN | `photo-grn`, `ocr-rx`     | `PhotoBillCapture.tsx` | - | 0024 | P |
| B11 | Distributor B2B portal | `web/distributor-portal`  | (web app) | - | 0028 | S |
| B12 | Cold-chain BLE temp logging | `cold-chain`            | `ColdChainScreen.tsx` | 0030 | 0050 | S |
| B13 | Counterfeit shield CNN + DataMatrix | `counterfeit-shield` | (in scan path) | - | 0047 | S |
| B14 | Returns to supplier (RTS) | `grn-repo`               | `GrnScreen.tsx` | - | - | S |
| B15 | Hardware-fingerprint license | (apps/desktop src-tauri) | (Rust)  | - | - | R |

## C. Compliance + Filing

| #   | Feature | Package(s) | Screen | Migration | ADR | Status |
|-----|---------|------------|--------|-----------|-----|--------|
| C1  | GST auto-compute | `gst-engine`                       | (in BillingScreen) | - | 0007 | R |
| C2  | GSTR-1 monthly export | `gstr1`                       | `ReportsScreen.tsx` | 0014 | 0015 | R |
| C3  | GSTR-3B summary | `gst-extras`                        | `ReportsScreen.tsx` | - | 0015 | S |
| C4  | GSTR-2A/2B reconciliation | `gst-extras`              | `ReportsScreen.tsx` | - | 0015 | S |
| C5  | GSTR-9 annual | `gst-extras`                          | `ReportsScreen.tsx` | - | 0015 | S |
| C6  | E-invoice IRN auto | `einvoice`                       | `BillingScreen.tsx` | 0016 | 0017 | R |
| C7  | E-Way Bill Part-A auto | `einvoice`                   | (post-IRN) | 0016 | 0017 | P |
| C8  | Schedule H/H1/X register UI | `schedule-h`            | `ComplianceDashboard.tsx` | - | - | P |
| C9  | NDPS Form 3D/3E/3H | `schedule-h`                     | `ComplianceDashboard.tsx` | - | - | P |
| C10 | DPCO/NPPA price-cap UI | `gst-engine`                 | `ProductMasterScreen.tsx` | 0006 | 0007 | P |
| C11 | PMBJP Jan Aushadhi | `pmbjp`                          | (in BillingScreen) | 0031 | 0051 | S |
| C12 | ABDM/ABHA verify + FHIR R4 | `abdm`                   | `ABHAVerifyModal.tsx` | 0032 | 0052 | S |
| C13 | DPDP consent + DSR | `dpdp`                            | `DPDPConsentScreen.tsx` | 0033 | 0053 | S |
| C14 | CERT-In incident notification | (runbook)             | `docs/install/DR_Runbook.docx` | - | - | P |
| C15 | Cold-chain AEFI auto-report | `cold-chain`            | `ColdChainScreen.tsx` | 0030 | 0050 | S |

## D. Customer + Clinical

| #   | Feature | Package(s) | Screen | Migration | ADR | Status |
|-----|---------|------------|--------|-----------|-----|--------|
| D1  | Customer master + Rx history | `directory-repo`        | `DirectoryScreen.tsx` | 0009 | 0006 | P |
| D2  | Doctor master + license + report | `directory-repo`     | `DoctorReportScreen.tsx` | - | 0006 | S |
| D3  | DDI check at line-add | `formulary`                  | `DDIAlertModal.tsx` | 0026 | 0034 | S |
| D4  | Allergy alert at line-add | `formulary`              | `AllergyAlertModal.tsx` | 0026 | 0034 | S |
| D5  | Refill prediction + churn | `churn-prediction`        | `DirectoryScreen.tsx` | - | 0046 | S |
| D6  | Multilingual side-effect read-aloud | `voice-billing`, `ai-copilot` | (smart receipt QR landing) | - | 0042 | S |
| D7  | Telemedicine Rx ingest | `ocr-rx`                     | `RxScanModal.tsx` | - | 0043 | S |
| D8  | Customer-facing kiosk | `web/customer-kiosk`         | (web app) | - | 0058 | S |
| D9  | Counseling script auto-draft | `ai-copilot`            | `CounselingScreen.tsx` | 0035 | 0048 | S |
| D10 | Loyalty tier + LTV pricing | `loyalty`, `churn-prediction` | `LoyaltyScreen.tsx` | 0034 | 0054 | S |

## E. Multi-Store + Cloud + Mobile + Web

| #   | Feature | Package(s) | App | ADR | Status |
|-----|---------|------------|-----|-----|--------|
| E1  | Single-store offline SQLite | `shared-db`             | `apps/desktop` | 002 | R |
| E2  | rqlite parent/worker LAN | (cloud-services Rust)    | `apps/cloud-services` | 0028 | S |
| E3  | Cloud bridge (CF Tunnel + NATS) | (cloud-services Go) | `apps/cloud-services` | - | S |
| E4  | Multi-tenant Postgres + RLS | (cloud-services)       | `apps/cloud-services` | - | S |
| E5  | Owner mobile app | -                                | `apps/mobile/owner` | - | S |
| E6  | Cashier mobile app | -                              | `apps/mobile/cashier` | - | S |
| E7  | Customer app | -                                    | `apps/mobile/customer` | - | S |
| E8  | Rider app | -                                       | `apps/mobile/rider` | - | S |
| E9  | Next.js storefront | -                              | `apps/web/storefront` | - | S |
| E10 | Distributor B2B portal | -                          | `apps/web/distributor-portal` | - | S |
| E11 | Webhook + REST + GraphQL APIs | (cloud-services)     | `apps/cloud-services` | - | S |
| E12 | Hardware kit guided setup wizard | (apps/desktop)    | `SettingsScreen.tsx` | - | S |

## F. AI / ML — woven across

| #   | Capability | Package | Tier | ADR | Status |
|-----|------------|---------|------|-----|--------|
| F1  | Voice billing | `voice-billing`                       | Edge | 0042 | S |
| F2  | OCR Rx scan | `ocr-rx`                                | Edge→cloud | 0043 | S |
| F3  | X3 photo-bill OCR | `photo-grn`, `ocr-rx`             | Frontier | 0024 | P |
| F4  | DDI + allergy + dose check | `formulary`              | Edge | 0034 | S |
| F5  | Demand forecasting | `demand-forecast`                | Cloud | 0044 | S |
| F6  | Near-expiry offload | `churn-prediction`              | Cloud | 0046 | S |
| F7  | Fraud / theft anomaly | `fraud-detection`             | Cloud | 0045 | S |
| F8  | Customer churn prediction | `churn-prediction`        | Cloud | 0046 | S |
| F9  | Counterfeit visual CNN | `counterfeit-shield`         | Edge | 0047 | S |
| F10 | AI Copilot (text-to-SQL via Cube.dev) | `ai-copilot`  | Frontier | 0048 | S |
| F11 | Counseling script auto-draft | `ai-copilot`            | Cloud | 0048 | S |
| F12 | Side-effect read-aloud TTS | `voice-billing`           | Cloud | 0042 | S |
| F13 | HSN auto-classifier | `ai-copilot`                    | Cloud | 0048 | S |
| F14 | DPDP DSR auto-respond | `dpdp`, `ai-copilot`          | Cloud | 0053 | S |
| F15 | Inspector Mode AI | `inspector-mode`, `ai-copilot`    | Frontier | 0049 | S |

## G. Hardware + Integrations

| #   | Feature | Package | Notes | Status |
|-----|---------|---------|-------|--------|
| G1  | Thermal printer ESC/POS | `printer-escpos`    | TVS RP-3230, Zebra GX420Rx, Epson TM-T81 | S |
| G2  | A4 laser receipt | `invoice-print`            | Existing iframe path | P |
| G3  | Dot-matrix Sched-X | `printer-escpos`         | Legal req in some states | S |
| G4  | Barcode scanner HID | -                         | OS handles | R |
| G5  | GS1 DataMatrix decoder | `printer-escpos`      | 2D + serial + batch + expiry | S |
| G6  | Cash drawer (RJ-11 trigger) | `printer-escpos`  | DK pulse via printer | S |
| G7  | CFD second monitor (HDMI) | `cfd-display`       | Tauri multi-window | S |
| G8  | Razorpay/Cashfree POS terminal | (apps/desktop) | (later) | - |
| G9  | UPI QR per bill | (apps/desktop)              | qrcode.js | S |
| G10 | BLE temp sensor | `cold-chain`                | Tauri Bluetooth plugin | S |
| G11 | Tally Prime XML export | `tally-export`       | Day Book + GSTR + Stock | S |
| G12 | Zoho/QuickBooks-IN export | `tally-export`    | Module within tally-export | S |

## H. Futuristic Differentiators

| #   | Feature | Package | App / Screen | ADR | Status |
|-----|---------|---------|--------------|-----|--------|
| H1  | AR shelf overlay | `ar-shelf`                       | `ARShelfOverlay.tsx` (also visionOS) | 0059 | S |
| H2  | Voice-first billing | `voice-billing`               | `VoiceBillingOverlay.tsx` | 0042 | S |
| H3  | AI Copilot ("why are sales down 12%?") | `ai-copilot`  | `CopilotPanel.tsx` | 0048 | S |
| H4  | Inspector Mode | `inspector-mode`                   | `InspectorModeScreen.tsx` | 0049 | S |
| H5  | Biometric Schedule-X dispense | (apps/desktop)      | `OwnerOverrideModal.tsx` ext | 0064 | S |
| H6  | Cold-chain IoT BLE mesh | `cold-chain`              | `ColdChainScreen.tsx` | 0050 | S |
| H7  | Smart receipt QR | `ai-copilot`                     | (PaymentModal embed) | 0048 | S |
| H8  | Counterfeit shield | `counterfeit-shield`           | (in scan path) | 0047 | S |
| H9  | Family Vault | `family-vault`                       | `FamilyVaultScreen.tsx` | 0060 | S |
| H10 | Digital Twin of shop | `digital-twin`               | `DigitalTwinScreen.tsx` | 0062 | S |
| H11 | Predictive maintenance | (telemetry + cloud)        | (in CopilotPanel) | 0065 | - |
| H12 | visionOS spatial UI | -                             | `apps/visionos` | 0063 | S |
| H13 | Carbon footprint per bill | `pmbjp`, `ai-copilot`   | (PaymentModal pill) | 0048 | S |
| H14 | Voice customer kiosk | `voice-billing`              | `apps/web/customer-kiosk` | 0042 | S |
| H15 | Open Pharmacy Plugin SDK | `plugin-sdk`             | `PluginMarketplaceScreen.tsx` | 0061 | S |

## Cross-cutting infra

| Concern | ADR | Status |
|---------|-----|--------|
| Idempotency tokens on Tauri commands | 0030 | S |
| Crypto-at-rest (AES-GCM + OS-keyring DEK) | 0031 | S (replaces stub) |
| ClearTax tax-parity check | 0032 | S |
| E2E test stack (Playwright on built MSI) | 0033 | S |
| Empty/loading/error state contract | (extends NORTH_STAR) | - |
| Reason-code library taxonomy | 0036 | S |
| i18n CI lint (block hardcoded English) | 0037 | S |
| RBAC roles + MFA | 0038 | S |
| Sentry/OTel/Grafana telemetry | 0065 | S |
| WebGPU + ONNX Runtime Web (browser ML) | 0066 | S |

## Total scaffold scope

- **26 new packages** in `packages/` (formulary, khata, cash-shift, tally-export, gst-extras, rbac, voice-billing, ocr-rx, demand-forecast, fraud-detection, churn-prediction, counterfeit-shield, ai-copilot, inspector-mode, cold-chain, pmbjp, abdm, dpdp, loyalty, whatsapp-bsp, printer-escpos, cfd-display, ar-shelf, family-vault, plugin-sdk, digital-twin)
- **24 new desktop screens/components** under `apps/desktop/src/components/`
- **15 new SQL migrations** (0023-0037)
- **37 new ADR drafts** (0030-0066)
- **9 new apps** (4 mobile + 3 web + cloud-services + visionos)

After scaffold, run `npm install` at root to pick up new workspaces; `npm run typecheck` to verify; `npm run test` to confirm placeholder tests pass.
