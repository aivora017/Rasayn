# Sprint 10 — Hardware drivers + WhatsApp BSP + Rust integration tests — COMPLETE

**Date:** 2026-04-29
**Window:** S10 (continuation of S9 same Cowork session)
**Goal:** Replace the last three stub-only packages with real, tested
implementations + add Rust integration tests for the new Tauri commands +
fully purge voice-billing remnants.

---

## 1. Deliverables

### 1.1 @pharmacare/printer-escpos (411 LoC + 271 LoC tests, 28 tests)

Pure ESC/POS command builder for thermal receipt printers (58mm + 80mm) and
ZPL II for barcode label printers. Caller injects a `PrinterTransport` —
Tauri sidecar / Web Serial / WebUSB — so the package itself is dependency-free.

Surfaces:
- `ESCPOS_INIT`, `ESCPOS_BOLD_ON/OFF`, `ESCPOS_CUT`, `ESCPOS_DRAWER_PIN_2/5`
- `escposJustify`, `escposTextSize`, `escposFeed`, `escposText`, `concatBytes`
- `escposQrCode(data, opts)` — full GS ( k command sequence (model/size/EC/store/print)
- `escposBarcode128(data, height)` — Code128 with HRI underneath
- `buildReceipt(input)` — full Indian tax-invoice receipt with header,
  GSTIN, line items, GST breakdown (CGST/SGST/IGST), totals, optional UPI QR,
  and footer. Supports 32-col (58mm) and 48-col (80mm) widths.
- `buildLabelZpl(input)` — barcode SKU label with name/batch/expiry/price
- `parseGs1Ais(raw)` — GS1 DataMatrix AI parser (01/10/17/21) handling both
  GS-separated streams and continuous strings
- `setPrinterTransport`, `discoverPrinters`, `printRaw`, `pulseCashDrawer`

Why this matters: Sourav has both a TVS RP-3230 thermal + an Argox barcode
printer at Jagannath. This package emits the correct bytes for both
without any external printer-driver dependency.

### 1.2 @pharmacare/cold-chain (283 LoC + tests, 17 tests)

Pure cold-chain temperature monitoring + alert state machine. Drug-class
storage windows (refrigerated 2–8°C, cool 8–15°C, room 15–30°C, below_25 <25°C)
match Indian Pharmacopoeia + WHO. State machine handles:
- WARNING band (±0.5°C around limit) vs CRITICAL (beyond tolerance)
- Grace-window suppression (30 min default — brief excursions don't alarm)
- Critical readings raise immediately (no grace)
- Peak severity escalation (warning→critical bumps the open alert)
- Returning to window auto-closes the active alert
- `buildComplianceLog` for inspector-mode roll-up

Why this matters: Sourav mentioned a "tester machine" — likely a temperature
probe or fridge thermometer. This package consumes those readings and emits
the log every drug inspector asks for.

### 1.3 @pharmacare/whatsapp-bsp (268 LoC + tests, 21 tests)

Pure WhatsApp Business message library with:
- 7 templates (bill_share, refill_reminder, payment_receipt, khata_payment_due,
  family_vault_invite, stockout_alert, appointment_reminder)
- 4 locales each (en_IN, hi_IN, mr_IN, gu_IN)
- 1-indexed `{{N}}` placeholder rendering with sanitization (strips
  `\n`, `\t`, collapses spaces — Meta rejects these)
- E.164 phone validation
- Outbound message queue with status state machine (queued/sending/sent/
  failed/delivered/read)
- Exponential backoff retry policy (30s, 60s, 2m, 4m, 8m; max 5 attempts)
- `sendOnce(transport, msg)` — caller injects any BSP (Cloud API, Gupshup,
  MSG91, AiSensy, Twilio); we never lock the customer to one vendor

Why this matters: hits the playbook's "no SaaS lock-in" rule head-on. Customer
chooses BSP at install time; same Rasayn code talks to all of them.

### 1.4 Rust integration tests (cash_shift / khata / rbac)

`#[cfg(test)] mod tests` blocks added to each Tauri command module. Each
test seeds an in-memory SQLite DB with the minimal schema needed and asserts:

- **cash_shift.rs** — 4 tests
  - Insert + find_open_shift roundtrip
  - compute_z_report aggregates bills + payments correctly
  - DenominationCountDto.total_paise math (₹3500 = 350 000 paise)
  - Negative denominations rejected
- **khata.rs** — 5 tests
  - fetch_limit returns None when unset
  - upsert_then_fetch roundtrip
  - upsert overwrites existing row (ON CONFLICT)
  - age_in_days = 0 for future dates
  - age_in_days computes 28 days correctly
- **rbac.rs** — 3 tests
  - ALLOWED_ROLES contains expected roles
  - upsert_override insert-then-update via ON CONFLICT
  - now_iso() emits valid RFC 3339

**Verification status:** Cargo isn't installed in the build sandbox, so these
tests are written but unrun. They ride to CI on the next Windows-MSI workflow
push and either pass or surface the precise borrow/type errors that need
fixing in S11 hotfix.

### 1.5 voice-billing fully purged

Verified gone from:
- `packages/voice-billing/` — deleted
- `apps/desktop/src/components/VoiceBillingOverlay.{tsx,test.tsx}` — deleted
- No remaining `voice-billing` or `VoiceBilling` references in apps/ or packages/

---

## 2. Test counter

| Package | Tests | Status |
| --- | --- | --- |
| @pharmacare/cash-shift | 25 | ✅ pass (S9) |
| @pharmacare/khata | 20 | ✅ pass (S9) |
| @pharmacare/rbac | 29 | ✅ pass (S9) |
| @pharmacare/printer-escpos | 28 | ✅ pass (S10 new) |
| @pharmacare/cold-chain | 17 | ✅ pass (S10 new) |
| @pharmacare/whatsapp-bsp | 21 | ✅ pass (S10 new) |
| Rust integration (cash_shift) | 4 | ⏳ CI (cargo not in sandbox) |
| Rust integration (khata) | 5 | ⏳ CI |
| Rust integration (rbac) | 3 | ⏳ CI |
| **S10 verifiable total** | **66** | ✅ |

---

## 3. Repo state

| Metric | After S9 | After S10 |
| --- | --- | --- |
| Real packages (pure-TS) | 40 | **43** |
| Stub-only packages | 6 | **3** (ocr-rx, ar-shelf, plus 1 misc) |
| Rust modules with tests | 0 | **3** |
| Rust LoC (cash/khata/rbac) | 1138 | **1383** (+245 test LoC) |
| Pure-logic test count | ~1138 | **~1204** |

---

## 4. Punch list to S11

1. Run `cargo test` in CI; fix any borrow/lifetime issues in the Rust
   integration tests (most likely candidates: `c.transaction()` borrow on
   `&Connection` parameters, `params!` macro borrow rules).
2. Wire `printer-escpos` into BillingScreen post-bill-save so receipt prints
   on the actual TVS RP-3230 (needs a Tauri `printer_write_bytes` command).
3. Wire `cold-chain` reading ingest to the digital-twin asset stream — feed
   readings from a temp probe over USB-serial.
4. Wire `whatsapp-bsp` `sendOnce` to a BSP transport (start with Meta Cloud
   API direct since user has Razorpay → likely already has Meta business).
5. Implement `ocr-rx` (Rx photo → structured prescription) and `ar-shelf`
   (shelf-pick AR overlay) — these are the last two stubs.
6. Add a Rust module + Tauri command for `printer-escpos` writing to OS
   default printer via the `opener`/`reqwest` deps that already exist.

---

## 5. Architecture decisions reaffirmed

- **No vendor lock-in** — every external integration (BSP, printer, BSP,
  forecaster, OCR) is a transport interface. The pure logic is in @pharmacare/*
  and has zero runtime deps.
- **Hindi/Marathi/Gujarati first** — every WhatsApp template ships in 4
  locales by default. The TS templates are the source of truth; Meta-side
  template registration happens via a separate ops script.
- **Bytes over driver lock-in** — printer-escpos emits Uint8Array. Whether
  the bytes go through a Tauri sidecar / Web Serial / WebUSB / OS spooler
  is a deployment decision, not a code decision.

---

**Sprint 10 closed.** 66 new+continuing pure-logic tests green, 12 Rust
integration tests authored (CI verification pending).

Next: **S11** — wire the new packages into UI screens (Billing print,
Cold-chain digital-twin telemetry, WhatsApp send buttons) + ship `ocr-rx`
+ make `cargo test` green in CI.
