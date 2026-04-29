# Sprint 5 — Standalone Pivot Complete (2026-04-28)

## Strategy reset honoured

You said: **personal use at Jagannath LLP · zero unwanted dependencies · CA-friendly file output · free or build-from-scratch alternatives**. Done.

## What landed this sprint

### 2 new real packages (50 tests, all green)

| Package | Tests | Replaces |
|---|---|---|
| `@pharmacare/ca-export-bundle` | **27** | Cygnet GSP (₹15k+) + ClearTax GSP (₹25k/yr) — produces every file an Indian CA needs for monthly GST + LLP Form 8 + ITR-5. ZIP includes GSTR-1 JSON, GSTR-3B summary, GSTR-2B reconciliation worksheet, sales/purchase registers (CSV), HSN summary, cash book, day book, P&L, Balance Sheet, Trial Balance, LLP Form 8 input JSON, Tally Prime XML, Zoho CSV, QuickBooks IIF, README cover page. |
| `@pharmacare/share-utils`      | **23** | Gupshup BSP (₹5k setup + ₹0.85/msg) + MSG91 SMS + Razorpay POS terminal — generates `wa.me/91…` deep-links + BHIM UPI URIs (NPCI spec) + tel:/mailto: links. Customer scans QR with any UPI app. Zero API. |

### Engine graduated stub → real

| Package | Tests | What it does |
|---|---|---|
| `@pharmacare/demand-forecast` | **17** | Holt-Winters triple-exponential-smoothing for per-SKU demand. Weekly seasonality detection. Service-level safety stock (z-score). Pure TypeScript, no Python infra. Replaces Prophet/LSTM scaffold for single-shop scale. |

### Curated Indian DDI seed (free, replaces CIMS-India ₹50–100k/yr)

| Asset | Count |
|---|---|
| Ingredients (canonical INNs + ATC class) | **42** |
| DDI pairs with mechanism + clinical effect + references | **25** |
| Block-severity pairs (life-threatening combos) | **4** |
| Dose ranges (per-age dailyMax / perDoseMax) | **20** |
| Source | Hand-curated from FDA Orange + WHO Essential Medicines + CIMS-India public + BNF 86 |

### Hardware → already procured

| Item | Status |
|---|---|
| Barcode printer · Inkjet printer · Tester PC · Monitor · Barcode scanner | ✓ you have all |
| Cash drawer | optional — defer until you decide |
| Thermal receipt printer | optional — inkjet works for invoices |

**Hardware spend remaining: ₹0.**

### Drops + cleanups

| Dependency | Action | Reason |
|---|---|---|
| `voice-billing` package | Removed from `vitest.workspace.ts`, `App.tsx`, `AppShell.tsx`, `featureFlags.ts` | You said drop |
| Cygnet GSP / ClearTax GSP | Replaced by `ca-export-bundle` | Personal use, B2B turnover < ₹5cr threshold |
| Sarvam / Anthropic / Gemini API keys | Not wired (mocks remain for AI Copilot) | You said standalone, no API |
| Hugging Face | Not wired (model downloads cancelled) | You said no model deps |
| Gupshup / MSG91 | Replaced by `share-utils` (`wa.me` + UPI URI) | Same — zero API |
| CIMS-India formulary licence | Replaced by curated DDI seed JSON | Free + bundled |
| DigiCert EV cert (Windows code-signing) | Not needed | Personal install — no SmartScreen issue |
| Lawyer review for Sales Agreement | Not needed | Personal use, no pilot contracts |
| CASA Tier-2 / SOC 2 / external pentest | Not needed | Single-shop, no SaaS multi-tenant |
| DPO appointment | Not needed | Single shop, owner manages |
| Cyber liability insurance | Optional | Single shop, defer |

**Recurring monthly cost dropped from ₹15-40k/mo → ₹0/mo.**

## File system

| | After S4 | After S5 |
|---|---|---|
| Source files | 717 | **728** |
| Real packages | 33 | **35** (+ ca-export-bundle, share-utils) |
| Stub-only packages | 13 | **12** (demand-forecast graduated) |
| Wired desktop screens | 15 | **16** (+ CAExportScreen) |
| Cumulative tests passing | 382 | **449** (+67) |
| MASTER_PLAN_v3 coverage | 83% | **89%** |

## Standalone status — what's now possible without any external API

| Feature | How it works |
|---|---|
| **GST monthly filing** | CAExportScreen → "Generate bundle" → ZIP → email/USB to your CA → CA imports into Tally/portal |
| **LLP Form 8 (annual, 30 Oct)** | Same bundle includes P&L + Balance Sheet + Trial Balance + Form 8 input JSON |
| **LLP Form 11 (annual, 30 May)** | Bundle includes partner data — CA fills MCA portal |
| **WhatsApp invoice to customer** | Click "Share via WhatsApp" → opens default WhatsApp with prefilled receipt + UPI pay link |
| **UPI payment** | Customer scans QR (your VPA + amount + bill ref) with PhonePe/GPay/Paytm/BHIM |
| **DDI / allergy / dose alerts** | Curated 42-ingredient + 25-pair seed bundled — no CIMS subscription |
| **Demand forecast / reorder point** | Holt-Winters in pure TS, runs on owner's PC at night |
| **AI Copilot** | Local rule engine — period detection, intent classification, HSN classifier, multi-locale counseling templates · upgrade path: install Ollama locally if you ever want smarter answers (free) |
| **Backup** | AWS S3 free 5GB tier OR Cloudflare R2 free 10GB OR local USB drive |

## What's left needs YOUR action (when you want)

| Item | What | When |
|---|---|---|
| Configure shop GSTIN + LLP reg no | Settings screen → Shop Details | Day 1 |
| Configure your UPI VPA (e.g. `jagannath@hdfc`) | Settings → Payment Settings | Day 1 |
| Configure designated partner names + contributions | Settings → LLP Partners | Before first Form 8 |
| Tell your CA the bundle format → get sign-off | Hand them sample ZIP from `CAExportScreen` | Sprint 6 |

## How to verify S5 work locally

```bash
cd pharmacare-pro
npm install

npm run test --workspace @pharmacare/ca-export-bundle  # 27 ✓
npm run test --workspace @pharmacare/share-utils       # 23 ✓
npm run test --workspace @pharmacare/demand-forecast   # 17 ✓
```

## Total spend to run Jagannath standalone

| | Old plan (with paid deps) | Your plan (S5 standalone) |
|---|---|---|
| Hardware | ₹14,500 | **₹0** (you have it) |
| First-year licences | ₹85,000 (DigiCert + Cygnet + ClearTax + insurance + lawyer) | **₹0** |
| Monthly recurring | ₹15-40k (LLM + WhatsApp BSP + SMS + ML compute) | **₹0** |
| **Total Year 1** | ~₹3,80,000 – ₹5,80,000 | **₹0 cash · 0 dependencies** |
