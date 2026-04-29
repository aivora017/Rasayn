# Sprint 7 — Sellable + Futuristic Engines (2026-04-28)

## TL;DR

**5 packages graduated to real (93 new tests, all green).** 2 brand-new packages built specifically for Phase C selling (`license`, `auto-update`); 3 stub→real graduations for futuristic features that don't need external runtime (`family-vault`, `cfd-display`, `digital-twin`).

## Packages

### NEW for sellable software (Phase C)

| Package | Tests | What it does |
|---|---|---|
| `@pharmacare/license` | **21** | Edition-flag licence keys (PCPR-YYYY-XXXX-XXXX-XXXX-XXXX-XXXX-CHECK). 14 edition flags (CORE_BILLING / AI_COPILOT / MULTI_STORE / etc) packed into 24 bits. Hardware-fingerprint-bound (CPU+MAC+disk hash). 60-day grace on hardware change. Verhoeff check digit. Trial / starter / pro / enterprise presets. |
| `@pharmacare/auto-update` | **28** | Update manifest schema (channels: stable / beta / nightly · per-platform assets · ed25519 sig). Semver compare. `checkForUpdate()` picks newest in user's channel. mandatory + minSupportedVersion both bubble correctly. Validates manifest server response before trusting. |

### Stub → REAL (futuristic features, TS data layer ready)

| Package | Tests | Highlight |
|---|---|---|
| `@pharmacare/family-vault` | **15** | Household graph + per-member consent + consolidated medication log. Cross-member action gated on explicit consent flags. Strangers can't view family data. Head-of-family can act for everyone. |
| `@pharmacare/cfd-display` | **14** | CFD state machine (idle → billing → payment → thankyou). postMessage protocol with monotonic seq, drift detection, stale-message rejection. Pure-TS state updaters (`addItem` / `applyTax` / `applyDiscount` / `enterPayment`). |
| `@pharmacare/digital-twin` | **15** | Asset registry (10 kinds: shelf / fridge / scanner / printer / cash drawer / monitor / router / UPS / biometric). Telemetry event apply. Auto-offline after 5min no-heartbeat. Health score 0–100 with A–F grade. Predictive maintenance: assets in WARN > 24 h get tailored recommendations per kind. |

## Sellability progress

| Phase C requirement | Status |
|---|---|
| License key generation + validation | ✓ shipped |
| Hardware-fingerprint binding + 60-day grace | ✓ |
| Edition flags (Free / Starter / Pro / Enterprise) | ✓ |
| Auto-update manifest schema | ✓ |
| Semver-aware update checker | ✓ |
| Channel rollout (stable / beta / nightly) | ✓ |
| Mandatory + minSupportedVersion gating | ✓ |
| ed25519 signature verification | contract defined; runtime verifier deferred (Tauri side) |

## Cumulative across 7 build sessions

| | Day 1 | After S7 |
|---|---|---|
| Real packages | 21 | **40** |
| Stub-only packages | many | **6** (voice-billing, ocr-rx, whatsapp-bsp, printer-escpos, cold-chain, ar-shelf) |
| Wired desktop screens | 0 | **19** |
| Cumulative TS tests | baseline | **+619** |
| Source files | 442 | **754** |

## Stubs remaining (only 6 left, all need external runtime)

| Package | Blocked by |
|---|---|
| voice-billing (Sarvam path) | Sarvam-Indus API key + WebGPU model |
| ocr-rx | Gemini 2.5 Vision API key |
| whatsapp-bsp | Gupshup BSP credentials |
| printer-escpos | USB hardware (TVS/Zebra/Epson printers) |
| cold-chain | BLE temperature sensors |
| ar-shelf | WebXR + WebGPU runtime |

Every stub still ships with locked TypeScript contracts + ADR — drops in when its runtime context unlocks.

## How to verify locally

```bash
cd pharmacare-pro
npm install

npm run test --workspace @pharmacare/license       # 21 ✓
npm run test --workspace @pharmacare/auto-update   # 28 ✓
npm run test --workspace @pharmacare/family-vault  # 15 ✓
npm run test --workspace @pharmacare/cfd-display   # 14 ✓
npm run test --workspace @pharmacare/digital-twin  # 15 ✓
```

## What I need from you (when ready, not now)

Nothing right now — everything I built today is pure TS, zero external dependency. When you decide to flip to **Phase C selling**, here's the order:

1. **Issue your first licence key** for Jagannath via `issueLicense({ preset: "enterprise", shopFingerprintShort: "...", validForDays: 365 })`. Run that in a quick Node script + paste the resulting key into Settings.
2. **Stand up update manifest** at `https://updates.<your-domain>/manifest.json` (Cloudflare Workers free tier). Format defined by `@pharmacare/auto-update`'s `UpdateManifest` type.
3. **Buy DigiCert EV cert** (₹35-55k) when you have first paying customer.

## What's next

Three remaining mass-impact features need wiring more than they need new code:

1. **Wire the screens to real DB RPCs** — Tauri commands for cash_shift, khata, rbac, ca-export, migration-import, data-export. ~1 week.
2. **Build licence-management UI** — Settings → License tab using `@pharmacare/license`. ~2 days.
3. **Build update-checker UI** — auto-runs at startup; shows update banner; downloads MSI. ~2 days.

The pharmacy-OS engine is now mature enough to be (a) used at Jagannath standalone today, (b) wrapped up as a sellable Windows MSI in 2-3 weeks of plumbing work.
