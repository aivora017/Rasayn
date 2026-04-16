# A6 · bill-core handoff

**Branch:** `feat/a6-bill-core`
**Parent:** `2595ba9` (PR #10 merge commit — A5 billing shell)
**ADR:** [0010-a6-bill-core.md](../../adr/0010-a6-bill-core.md)
**Author:** aivora017 <aivora017@gmail.com>
**Date:** 2026-04-16

## Scope

ADR 0004 row A6 acceptance: `bills` + `bill_lines` tables with FEFO
auto-pick, **manual batch override (F7)**, qty/disc/free-qty, in-memory
recompute on every keystroke, **10-line bill computed + saved p95 <400 ms**
on reference hardware, **NPPA + GST re-check on save**.

Tables, triggers, FEFO view, and BillingScreen save-path existed from A1/A2/A5.
A6 closes the three gaps that separate "save works" from "save is the business
spine":

1. **Host-side canonical writer.** `@pharmacare/bill-repo` v0.2.0 is now the
   spec for bill math, mirroring (and eventually replacing) Rust
   `save_bill::compute_line`. Single source of truth for any future invoice /
   print / export / return path.
2. **NPPA/DPCO enforcement at save.** Both TS `computeBill` and Rust
   `save_bill` hard-fail if any line's MRP exceeds `products.nppa_max_mrp_paise`.
   Reason code `NPPA_CAP_EXCEEDED:<productId>` (Rust) /
   `NppaCapExceededError{productId,mrpPaise,capPaise}` (TS).
3. **F7 manual batch override UI.** Keyboard-only modal picker; targets the
   last-added line; ↑/↓/Enter/Esc; auto-re-takes MRP from the picked batch.

## Files

| File | LoC delta | Purpose |
| :-- | --: | :-- |
| `docs/adr/0010-a6-bill-core.md` | +177 | New ADR |
| `packages/bill-repo/package.json` | +2 -1 | v0.2.0, adds `batch-repo` dep |
| `packages/bill-repo/src/index.ts` | +287 -62 | `computeBill`, `saveBill`, `NppaCapExceededError`, `listCandidateBatches` |
| `packages/bill-repo/src/index.test.ts` | +278 -66 | 18 tests (loadShopCtx, listCandidateBatches, computeBill ×7, saveBill ×7) |
| `packages/bill-repo/src/perf.test.ts` | +157 | 10-line × 100-iter perf gate (<400 ms) |
| `docs/evidence/a6/perf.json` | +24 | CI perf snapshot |
| `apps/desktop/src-tauri/src/commands.rs` | +49 | `list_fefo_candidates` Tauri command + NPPA re-check in `save_bill` |
| `apps/desktop/src-tauri/src/main.rs` | +1 | Register `list_fefo_candidates` in `invoke_handler` |
| `apps/desktop/src/lib/ipc.ts` | +5 | `listFefoCandidatesRpc` TS binding |
| `apps/desktop/src/components/BillingScreen.tsx` | +170 -3 | F7 handler + modal + commit logic |
| `apps/desktop/src/components/BillingScreen.test.tsx` | +66 | 4 new F7 tests (open / ↓+Enter swap / Esc no-mutate / no-lines toast) |

## Test results

**Monorepo (`npx turbo run build test --concurrency=1`):** 28/28 tasks green.

| Package | Tests | Status |
| :-- | --: | :-- |
| `@pharmacare/bill-repo` index.test.ts | 18 | ✅ |
| `@pharmacare/bill-repo` perf.test.ts (gate 400 ms) | 1 | ✅ p95 = 2.08 ms |
| `@pharmacare/desktop` BillingScreen.test.tsx | 18 (14 A5 + 4 A6) | ✅ |
| `@pharmacare/desktop` total | 65 | ✅ |
| `@pharmacare/seed-tool` | 8 | ✅ |

**TypeScript:** `tsc --noEmit` clean across desktop + all packages.

**Rust:** NOT compiled in sandbox (no cargo). Windows `cargo check` required
pre-merge. Changes are low-risk (one new command, three-line NPPA loop); see
§Rust-side verification below.

## Perf snapshot

`docs/evidence/a6/perf.json` — Linux/i3-12100/in-mem SQLite, 10-line FEFO
auto-pick bills, 100 iterations, 5 warmup:

| | ms |
| :-- | --: |
| p50 | 0.68 |
| p95 | 2.08 |
| p99 | 2.53 |
| max | 11.06 |
| gate | **< 400** |

CI clears by ~200×. Real gate is the i3-8100 / 4 GB / HDD / Windows 7 A15
regression VM — HDD fsync cost will dominate; expect p95 in the 50–150 ms
range there, still comfortably inside 400 ms.

## Rust-side verification (Windows, pre-merge)

```powershell
cd D:\pharmacare-pro\apps\desktop\src-tauri
cargo check
# Expect: Finished `dev` profile in <2 min on first run
# If it fails, the only likely errors are (a) missing import for
# list_fefo_candidates in main.rs — already added; (b) rusqlite Option<i64>
# param in the NPPA loop — uses the same pattern as existing shop_state query.
```

## Rollback

`git revert 2595ba9..HEAD` (the single A6 merge commit once PR #11 lands).
bill-repo v0.2.0 is additive — v0.1.0 stub still builds. No schema changes,
no data migration, triggers already existed from migration 0001.

## Next work (follow-ups, NOT in this PR)

- **A15 parity harness.** Retire Rust `compute_line` in favour of a
  generated-from-spec module seeded by `bill-repo.computeBill`. Add a 100-row
  golden-fixture test (`packages/bill-repo/src/parity.test.ts`) asserting
  byte-identical output Rust↔TS.
- **F7 per-line targeting.** Currently only the last-added line is targetable.
  Add an arrow-step selection or inline F-key so cashier can override
  mid-bill without deleting/re-adding lines.
- **Multi-batch split.** When a draft qty spans >1 batch, `bill-repo` throws
  and forces the cashier through F7 repeatedly. Real answer is a "split into N
  lines" UX — queued for A8/A9 after payment flow lands.
- **Payment mode wiring (A8).** `paymentMode` is still hard-coded `"cash"` in
  BillingScreen. F6 opens the modal; cash-only confirmation lands here.

## Open questions / known debt

- `docs/evidence/a6/perf.json` is Linux-x64/in-mem numbers. A15 will add a
  dual-axis perf report (dev-box vs regression-VM) so trends are comparable.
- BillingScreen's batch-override modal uses a global `window` keydown listener
  at capture-phase to avoid racing the outer billing key handler. If another
  A-series feature adds a higher-priority capture-phase listener, rework to
  use focus-scoped handling.
- F7 reads `lines[target].productId!` (non-null assertion). Guarded by an
  empty-lines check + a productId-null check before opening; defensive but
  not proven by a test.
