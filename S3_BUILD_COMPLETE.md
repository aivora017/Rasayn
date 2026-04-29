# Sprint 3 Build — UI rollout + AI/ABDM/PMBJP engines (2026-04-28)

## TL;DR

**4 more packages graduated stub → REAL** (`inspector-mode`, `pmbjp`, `abdm`, `ai-copilot`) — total real packages now **31**.
**6 more desktop screens** (`CopilotPanel`, `DoctorReportScreen`, `LoyaltyScreen`, `DPDPConsentScreen`, `VoiceBillingOverlay`, `ReportsExportPanel`) — wired to backing engines.
**DDI clinical-safety pipeline** — `useDdiCheck` hook + real `DDIAlertModal` + `AllergyAlertModal` ready for `BillingScreen` drop-in.

**84 new tests this session, all green.** Cumulative across all 3 build sessions: **348 tests across 15 real packages.**

## What landed

### Engines (4 packages, all green)

| Package | Tests | What it does |
|---|---|---|
| `@pharmacare/inspector-mode` | 13 | Pure aggregator: Schedule H/X registers + IRN reconciliation + NPPA breaches + expired stock disposal + counseling summary → printable Markdown report. Red flags + compliant sections auto-derived. |
| `@pharmacare/pmbjp` | 15 | Generic-substitution engine + 50-row Jan Aushadhi sample catalog. Confidence-scored suggestions (exact_match / form_strength_match / molecule_match_only). `basketSavings` aggregator. |
| `@pharmacare/abdm` | 29 | ABHA Verhoeff checksum + format normalize · 8-state verification machine · FHIR R4 MedicationDispense builder · push retry exponential backoff (1m → 24h, max 5 attempts). |
| `@pharmacare/ai-copilot` | 27 | Intent classifier (trend/compare/explain/counseling/report/action) · period detector · multi-locale counseling templates (en/hi/mr/gu/ta for antibiotic/antihypertensive/antidiabetic/analgesic) · HSN classifier (rule-based) · LlmGateway + SemanticLayer contracts + Mock implementations. `ask()` orchestrator. |

### UI screens (6 components)

| Component | LOC | What it shows |
|---|---|---|
| `CopilotPanel.tsx`        | 158 | Conversational Q&A with suggested prompts · narrative + chart + suggested actions · 5-locale picker |
| `DoctorReportScreen.tsx`  | 137 | Top doctors leaderboard · period filter (30/90/365d) · phonetic dedup with `phoneticKey()` · drug-class breakdown |
| `LoyaltyScreen.tsx`       | 192 | Tier ribbon (color-coded bronze/silver/gold/platinum) · active campaigns list · sample-discount calculator · cashback ledger · tier ladder ref |
| `DPDPConsentScreen.tsx`   | 149 | Two-tab: DSR queue with 30-day urgency badges + state-machine action buttons; consent matrix with ✓/— per purpose |
| `VoiceBillingOverlay.tsx` | 208 | Web Speech API (browser-native ASR — works today!) · Alt+V toggle · 5-locale picker · live transcript + intent classification · command dispatch |
| `ReportsExportPanel.tsx`  | 153 | 6 export buttons: Tally Prime XML · Zoho Books CSV · QuickBooks IIF · GSTR-3B · GSTR-2B reconcile · GSTR-9. Client-side blob download. |

### DDI clinical-safety integration (closes DANGEROUS gap)

| File | Purpose |
|---|---|
| `lib/useDdiCheck.ts`            | React hook wrapping `@pharmacare/formulary.checkAll`. Stable basket signature, async-shaped for future server-side calls. |
| `components/DDIAlertModal.tsx`  | Real modal (was scaffold). Severity-aware: block disables save + requires owner override; warn requires acknowledge; info auto-dismisses. Renders DDI / allergy / dose alerts with mechanism + clinical effect text. |
| `components/AllergyAlertModal.tsx` | Filtered wrapper around DDIAlertModal showing only allergy-kind alerts. |

**Drop-in for BillingScreen:**
```tsx
const { alerts, hasBlocker } = useDdiCheck({ basket, customerId, patientAgeYears, ddiTable, customerAllergies, doseRanges });
// Disable F10 save button when hasBlocker
// Render <DDIAlertModal alerts={alerts} ... /> when alerts.length > 0
```

## File system

| | After S2 | After S3 |
|---|---|---|
| Source files | 742 | 714 (cleanup of session symlinks; net +new screens) |
| Real packages | 27 | **31** (+4) |
| Real desktop screens | 3 | **9** (+6) |
| Cumulative tests passing | 264 | **348** (+84) |

## Cumulative pharmacy-OS coverage

| Feature category | Status |
|---|---|
| Idempotency (3 critical writers) | ✓ S2 |
| Cash shift / Z-report | ✓ engine + screen |
| Khata credit ledger | ✓ engine + screen |
| RBAC + MFA | ✓ engine + screen |
| Tally / Zoho / QuickBooks export | ✓ engine + screen |
| GSTR-3B / 2B / 9 | ✓ engine + screen |
| DDI / allergy / dose checks | ✓ engine + hook + modal (BillingScreen wire-up = 1 hr) |
| Loyalty + campaigns + cashback | ✓ engine + screen |
| DPDP consent + DSR | ✓ engine + screen |
| Plugin SDK | ✓ engine (UI deferred) |
| Counterfeit shield | ✓ engine (CNN inference deferred) |
| Inspector Mode | ✓ engine (UI deferred) |
| PMBJP generic substitution | ✓ engine + 50-row catalog |
| ABDM/ABHA + FHIR R4 | ✓ engine + state machine |
| AI Copilot | ✓ engine + mock LLM gateway + screen |
| Voice billing | ✓ Web Speech API works today; Sarvam upgrade deferred |
| Doctor-wise sales report | ✓ screen with phonetic dedup |

**Pure-engine coverage of MASTER_PLAN_v3 features: 17/24 (71%)**, up from 13/24 at start of S3.

## What's left (Sprint 4+ honest scope)

These all need runtime/hardware/credentials that don't exist in this sandbox:

| Package | Blocked by |
|---|---|
| `voice-billing` (full Sarvam) | Sarvam-Indus API credentials + WebGPU model loading |
| `ocr-rx` (real OCR) | Gemini 2.5 Vision API key |
| `demand-forecast` (Prophet/LSTM) | Python ML training infrastructure |
| `fraud-detection` (Isolation Forest) | scikit-learn runtime |
| `churn-prediction` (XGBoost) | XGBoost runtime |
| `whatsapp-bsp` | Gupshup BSP API credentials |
| `printer-escpos` | USB hardware (TVS / Zebra / Epson printers) |
| `cold-chain` | BLE temp sensor hardware |
| `cfd-display` | Tauri multi-window setup |
| `ar-shelf` | WebXR + WebGPU runtime |
| `digital-twin` | React-Three-Fiber wiring |
| `family-vault` | depends on `abdm` live API |

All of these have **scaffolds that compile**, **TypeScript contracts locked**, and **clear ADRs** — they drop in as the runtime context unlocks.

## Local verification

```bash
cd pharmacare-pro
npm install

# All this session's new packages
npm run test --workspace @pharmacare/inspector-mode  # 13 ✓
npm run test --workspace @pharmacare/pmbjp           # 15 ✓
npm run test --workspace @pharmacare/abdm            # 29 ✓
npm run test --workspace @pharmacare/ai-copilot      # 27 ✓
```
