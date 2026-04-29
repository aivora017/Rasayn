# Sprint 14 — S13 punch list cleared — COMPLETE

**Date:** 2026-04-29
**Window:** S14 (continuation of S13 same Cowork mandate)
**Goal:** clear the four S13 punch-list items so the integration sprint is
truly closed — Settings → Printer UI, Share-via-WhatsApp button on the bill
toast, photo-grn (X3) Tauri command + PhotoBillCapture wiring, and a real
PDF renderer for the Shift-Handover Save PDF action.

---

## 1. Deliverables

### 1.1 PrinterSettingsScreen (S14.1)

`apps/desktop/src/components/PrinterSettingsScreen.tsx` (167 LoC)

- Calls `printerListRpc()` on mount; lists installed printers with kind chip.
- "Set thermal" / "Set label" persists default via `lib/printer.ts`
  `setDefaultThermalPrinter` / `setDefaultLabelPrinter` (localStorage).
- "Test fire" sends a 30-byte ESC/POS init burst via `printerTestRpc`.
- Wired into `mode.ts` (`"printerSettings"`), `featureFlags.ts`
  (`printerSettings: true` default), `App.tsx` render branch, and
  `AppShell.tsx` PREVIEW_ITEMS (with `Printer` icon).

### 1.2 BillingScreen "Share via WhatsApp" button (S14.2)

After bill save, if `customer.phone` is E.164, a green "Share via WhatsApp"
button surfaces above the IRN chip. Click → fetches full bill, builds
`bill_share` template values (customer name, bill no, total, deep link),
calls `queueAndShare` and opens `wa.me`. Errors fall back to the toast.

`data-testid="bill-share-whatsapp"` for E2E coverage.

### 1.3 Photo-GRN (X3) Tauri command + PhotoBillCapture wiring (S14.3)

- `apps/desktop/src-tauri/src/photo_grn.rs` (93 LoC) — Tauri command
  `photo_grn_run` that accepts `photoBytesB64 + reportedMime + shopId`,
  validates ≤10 MiB, computes SHA-256, returns Phase-1 stub `PhotoGrnResultDto`
  matching the JS-side `@pharmacare/photo-grn` shape.
- Registered in `main.rs` invoke_handler (now 79 commands).
- `Cargo.toml` adds `hex = "0.4"`.
- `apps/desktop/src/lib/ipc.ts` gets `PhotoGrnInputDTO`, `PhotoGrnResultDTO`,
  IpcCall variant, and `photoGrnRunRpc()` wrapper.
- `PhotoBillCapture.tsx` — replaces the simulated 220ms scan loop with a real
  `photoGrnRunRpc` call. Animation still runs (0–85% scan-line) while the
  Tauri command executes; on completion the confidence chip shows the actual
  tier confidence × 100.

### 1.4 PDF renderer for ShiftHandoverPreview Save PDF (S14.4)

- `apps/desktop/src/lib/pdf.ts` (127 LoC) — hand-crafted PDF 1.4 generator.
  Single page (A4), Helvetica core font, 70-col wrap, no runtime dep.
- `CashShiftScreen.onSavePdf` now calls `buildSimplePdf(title, body)` and
  `downloadPdf(name, blob)` instead of writing a `.txt` blob. Handover
  arrives as a real `application/pdf`.

### 1.5 Verification

| Check | Result |
| --- | ---: |
| 12 package vitest suites (S13 11 + photo-grn) | **221 / 221 ✓** |
| `tsc --strict --exactOptionalPropertyTypes` over all `apps/desktop/src/**/*.{ts,tsx}` (sources, not tests) | **0 errors ✓** |
| New IPC contract additions | `photo_grn_run` registered; `photoGrnRunRpc` typed |

---

## 2. Repo state delta vs S13

| Metric | After S13 | After S14 |
| --- | ---: | ---: |
| Tauri commands registered | 78 | **79** (+ `photo_grn_run`) |
| Rust modules in `src-tauri/src/` | 22 | **23** |
| Screens in apps/desktop/src/components | 32 | **33** (+ `PrinterSettingsScreen`) |
| `lib/*.ts` count | 7 | **8** (+ `pdf.ts`) |
| Mode union members | 38 | **39** |
| Feature flags exposed | 36 | **37** |
| AppShell preview-nav items | 27 | **28** |

---

## 3. Open / deferred to S15

1. Settings → Printer can't truly test on Linux/macOS without an attached
   thermal printer — pilot testing on Jagannath laptop will exercise it.
2. Photo-GRN Tier-A (regex) / Tier-B (LayoutLMv3) / Tier-C (vision LLM)
   orchestrators — Phase 2 of ADR-0024.
3. Share-via-WhatsApp uses placeholder `https://rasayn.in/b/<shortid>` URL.
   Real bill-view route lands when the storefront ships.
4. PDF renderer is single-page only. Multi-page handover (>~70 lines) is a
   small extension if needed.
5. act() warnings in Dashboard/CashShift/RBAC/DoctorReport tests — cosmetic.

---

## 4. Punch list to S15

- Real photo-grn Tier-A (regex over OCR text from the JS-side Tesseract
  worker) so we don't always require operator review.
- Multi-store stock transfer real impl (StockTransferScreen is still mock).
- Counterfeit shield CNN (X1 moat is the only one fully wired; X3 is now
  half-wired; X2 has the full image upload flow).
- Pilot kit polish for Jagannath — onsite Day-1 install runbook.

---

**Sprint 14 closed.** S13 punch list is fully cleared. Four small surfaces
each shipped end-to-end on top of the green S13 base. 221/221 package tests,
0 strict tsc errors.
