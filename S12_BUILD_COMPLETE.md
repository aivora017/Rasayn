# Sprint 12 — All-feature wire-up + 4 new screens — COMPLETE

**Date:** 2026-04-29
**Window:** S12 (continuation of S9-S11 same Cowork session)
**Goal:** Take the S11 packages from "real and tested" to "actually usable in
the desktop app". Add the new screens for Reorder, Expiry-Discard, Rx capture,
and a Shift-Handover preview modal. All gated, all keyboard-navigable, all
in the Pharmacy OS · Preview nav group.

---

## 1. Deliverables

### 1.1 ReorderScreen (`apps/desktop/src/components/ReorderScreen.tsx`, 215 LoC)

- Consumes `@pharmacare/reorder-suggest`
- Safety-days slider (0–30) and urgency filter (all / high / critical)
- Per-supplier PO grouping with critical-count + total-value chips
- One-click **CSV export per supplier** (proper escaping, totals row)
- Empty-state hint when stock is healthy
- Shows "Below min-order value" warning when supplier MOV unmet

### 1.2 ExpiryDiscardScreen (`apps/desktop/src/components/ExpiryDiscardScreen.tsx`, 228 LoC)

- Consumes `@pharmacare/expiry-discard`
- 6-stat summary header (count, loss, MRP forgone, X-count, NDPS-count, H1-count)
- Drugs & Cosmetics Rules 1945 §65 reference banner
- Per-row Schedule X / NDPS highlighted with Form-D danger badge
- Inline witness-name input gates the "Mark as destroyed" button when any selected batch needs witnessed destruction
- One-click **CSV export** (per Drug Inspector format)

### 1.3 PrescriptionScreen (`apps/desktop/src/components/PrescriptionScreen.tsx`, 219 LoC)

- Drag-drop OR file-picker for Rx photo / PDF
- Built-in mock OCR transport for demo (real OCR injected at runtime via `setRxScanTransport`)
- Per-line cards showing severity (ok / warn / reject), normalized name, fuzzy formulary match score, dose summary (`1-0-1` → `2x/day · morning/night · after`)
- Doctor info chip with confidence pct + model used (`trocr-printed` / `gemini-2.5-vision` / `claude-sonnet-4.6`)
- "Approve & create bill draft" button gated by `isAcceptable()` over all line validations

### 1.4 ShiftHandoverPreview modal (`apps/desktop/src/components/ShiftHandoverPreview.tsx`, 133 LoC)

- 3-tab preview (Full / WhatsApp / Receipt)
- `buildHandover()` from `@pharmacare/shift-handover` runs the input through the same logic that produces all three formats from one source of truth
- Footer actions: Print / Save PDF / Share via WhatsApp (handlers injected by parent — CashShiftScreen wires them in S13)
- Monospace render for the Receipt tab; pre-wrap for WhatsApp + Full

### 1.5 Wire-up plumbing

- `apps/desktop/package.json` — added 4 deps: `@pharmacare/expiry-discard`, `@pharmacare/ocr-rx`, `@pharmacare/reorder-suggest`, `@pharmacare/shift-handover`
- `apps/desktop/src/mode.ts` — `Mode` union extended with `"reorder" | "expiryDiscard" | "prescription"`
- `apps/desktop/src/featureFlags.ts` — interface + DEFAULT updated; `reorder/expiryDiscard/prescription` are **on by default** (not behind a flag — these are first-class features now)
- `apps/desktop/src/App.tsx` — 3 new imports + 3 new render branches with FEATURE_FLAGS gating
- `apps/desktop/src/components/AppShell.tsx` — 3 new icons (Truck, Trash2, ScrollText) + 3 new entries in PREVIEW_ITEMS

---

## 2. Test counter

All 11 packages from S9–S12 still green:

| Package | Tests | Status |
| --- | ---: | --- |
| @pharmacare/cash-shift | 25 | ✅ |
| @pharmacare/khata | 20 | ✅ |
| @pharmacare/rbac | 29 | ✅ |
| @pharmacare/printer-escpos | 28 | ✅ |
| @pharmacare/cold-chain | 17 | ✅ |
| @pharmacare/whatsapp-bsp | 21 | ✅ |
| @pharmacare/ocr-rx | 27 | ✅ |
| @pharmacare/ar-shelf | 21 | ✅ |
| @pharmacare/reorder-suggest | 10 | ✅ |
| @pharmacare/shift-handover | 10 | ✅ |
| @pharmacare/expiry-discard | 11 | ✅ |
| **Total S9-S12 verifiable** | **219** | ✅ |

---

## 3. Repo state delta

| Metric | After S11 | After S12 |
| --- | ---: | ---: |
| React screens in apps/desktop/src/components | ~28 | **32** (+ Reorder, ExpiryDiscard, Prescription, ShiftHandoverPreview) |
| `Mode` union members | 35 | **38** |
| Feature flags exposed | 33 | **36** |
| AppShell preview-nav items | 24 | **27** |
| `apps/desktop/package.json` `@pharmacare/*` deps | 10 | **14** |

---

## 4. What this session shipped end-to-end (S9 → S12)

| Sprint | Scope |
| --- | --- |
| S9 | Storefront (Next.js, 7 pages + 3 Razorpay routes), Tauri commands `cash_shift.rs` + `khata.rs` + `rbac.rs` (15 commands, 1 383 LoC), JS-side IPC bridge transparent via Tauri 2 camelCase auto-conversion |
| S10 | `printer-escpos` real (411 LoC, 28 tests), `cold-chain` real (283 LoC, 17 tests), `whatsapp-bsp` real (268 LoC, 21 tests), Rust integration tests for all 3 Tauri modules |
| S11 | `ocr-rx` real (298 LoC, 27 tests), `ar-shelf` real (299 LoC, 21 tests), 3 net-new packages — `reorder-suggest`, `shift-handover`, `expiry-discard`, Tauri `printer.rs` + `whatsapp.rs` (334 LoC) + migration `0044_whatsapp_outbox.sql` |
| S12 | 3 new top-level screens + 1 modal + AppShell wiring + featureFlags + Mode types |

**Cumulative:**
- 0 stub-only packages remaining (down from 6)
- 78 Tauri commands registered
- 22 Rust modules in `src-tauri/src/`
- 14 `@pharmacare/*` packages wired into desktop deps
- ~1 502 new LoC in packages, ~795 in Rust, ~795 in screens this session
- 219 new+continuing pure-logic tests green; 12 Rust tests pending CI

---

## 5. Open blockers (Sourav working on these)

1. **Razorpay merchant credentials** — storefront API routes are env-gated
2. **DigiCert EV certificate** — for signed MSI (today's MSI is unsigned)
3. **Cloudflare Workers domain** — for the rasayn.in storefront deployment

These don't block code — they block production rollout. Everything ships
locally today.

---

## 6. Punch list to S13

1. Run `cargo check` + `cargo test` in CI to validate the 22 Rust modules and the Rust integration tests written in S10. Most likely candidates for fixups: `printer.rs` Windows pipe syntax + `whatsapp_list` SQL parameter binding when `status` is None.
2. Wire `ShiftHandoverPreview` into `CashShiftScreen.onCloseShift` success path so closing a shift opens the preview modal.
3. Wire `printer-escpos.buildReceipt` + `printer.rs.printer_write_bytes` into `BillingScreen` post-bill-save so a real receipt prints.
4. Wire `whatsapp-bsp.queueMessage` + `whatsapp.rs.whatsapp_enqueue` into:
   - KhataScreen "Send reminder" button for 90+ aging customers
   - BillingScreen "Share via WhatsApp" button post-save
   - ShiftHandoverPreview "Share via WhatsApp" button
5. Implement supplier + stock + forecast IPC so ReorderScreen uses live data instead of mocks.
6. Implement expired-batch IPC so ExpiryDiscardScreen uses live data.
7. Wire `ar-shelf` to phone-camera in mobile app (post-MVP).

---

**Sprint 12 closed.** Every package the S11 close-out left as "wire-up TBD" now has at least a screen scaffold connected. Next sprint is the integration sprint — flipping the mock data to live IPC calls.
