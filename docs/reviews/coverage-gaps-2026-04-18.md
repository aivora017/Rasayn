# Test Coverage Gap Audit
# Date 2026-04-18. Main tip 2f0fde3.

Static audit only — no vitest run. Method: enumerate every `*.ts(x)` under
`packages/*/src/` and `apps/desktop/src/` (excluding `*.d.ts`, test/fixture
files, index barrels under 10 lines, and `src/test/` helpers), check for a
sibling `*.test.ts(x)` or an indirect test-covers-via-barrel relationship,
and rate residual risk. Rust files under `apps/desktop/src-tauri/src/` are
counted by `#[test]` / `#[tokio::test]` occurrences.

---

## TL;DR

- 70 source files total in scope: 50 TS under `packages/*/src/`, 20 TS/TSX
  under `apps/desktop/src/`.
- Direct tests: 41 files (59%). Indirect-only coverage: 9 files (13%).
  No coverage: 20 files (29%).
- Rust: 15 `.rs` files, 10 carry a `#[cfg(test)]` block, 42 test fns total.
  4 files with zero tests: `db.rs`, `main.rs`, `oauth/keyring_store.rs`,
  `oauth/mod.rs`.
- **CRITICAL gaps: 3** (lib/ipc.ts, ProductMasterScreen, db.rs)
- **HIGH gaps: 5** (DirectoryScreen, ReportsScreen, OwnerOverrideModal,
  GmailInboxScreen, SupplierTemplateScreen)
- **MEDIUM gaps: 6** (ProductSearch, pendingGrnDraft, gstr1/aggregate,
  gstr1/csv, gmail-inbox/index, seed-tool/data, einvoice/types,
  shared-types/* non-validator type barrels)
- **LOW / OK-to-skip: 6** (type-only barrels, `main.tsx`,
  `einvoice/index.ts`, `shared-types/index.ts`, constants files).

---

## Critical gaps (untested + high-risk)

### G01 `apps/desktop/src/lib/ipc.ts`
- **Lines**: 1272.
- **Role**: The single IPC abstraction between React and Tauri/Rust. Defines
  every DTO shape (`SaveBillInput`, `PaymentRowDTO`, `GmailMessageSummary`,
  `ExpiryOverrideResultDTO`, `ProductHit`, `SupplierTemplateDTO`, ~60+
  types) and every `*Rpc` wrapper. Hosts the dev/test mock-handler registry
  (`setMockHandler`) that every component test depends on.
- **Risk if broken**: A DTO-shape drift here is invisible at compile time
  if Rust changes a `rename_all = "camelCase"` field; app silently sends
  snake_case and the Rust side returns a validation error the user reads
  as "save failed". Because this module is imported by every screen,
  regressions cascade to every billing, GRN, payment and Rx flow.
- **Suggested tests**:
  - Round-trip each exported `*Rpc` through a recorded-fixture mock handler
    and assert the JSON payload key shape matches the Rust `serde` struct
    (snapshot per command).
  - Assert `TENDER_TOLERANCE_PAISE === 50`, `GST_RATES` enum membership,
    and every discriminated union covers the documented variants.
  - Cover the mock-handler dispatch: default handler throws, replaced
    handler returns typed, unknown command rejects with a named error.
  - Negative: malformed server responses produce a typed `IpcError` with
    the command name, not an opaque TS exception.
  - Boundary: `paise` fields reject non-integer / negative values where
    the schema forbids them (if the wrapper does client-side validation).

### G02 `apps/desktop/src/components/ProductMasterScreen.tsx`
- **Lines**: 508.
- **Role**: A1 SKU master CRUD — creates / updates / deactivates
  `products` rows, attaches image blobs (SKU images moat, ADR 0018),
  enforces Schedule H/H1/X and HSN validation, drives keyboard-first
  Alt+N / Alt+S / Alt+D / Esc / /.
- **Risk if broken**: Silent acceptance of a product with wrong GST rate
  (5 vs 12) propagates into every bill going forward — GSTR-1 filings
  become wrong without any error. Schedule misclassification (e.g.
  Tramadol written as "G" instead of "H1") is a regulatory violation
  surfaced only at a drug-inspector audit. Image upload path bypasses
  mime-sniff if client skips `validate` (defense in depth breaks).
- **Suggested tests**:
  - Create → list → edit → deactivate happy path with keyboard only.
  - Reject HSN outside `PHARMA_HSN` list with the specific ValidationError
    surfaced to the user.
  - Schedule "H1" without mandatory AIO/batch fields is blocked.
  - Image upload: PNG accepted, GIF rejected (matches Rust mime sniff),
    >5 MB rejected, SHA-256 computed client-side matches server echo.
  - Deactivate confirms with Enter, Esc cancels, no destructive call on
    cancel.

### G03 `apps/desktop/src-tauri/src/db.rs`
- **Lines**: 250. Zero `#[cfg(test)]`.
- **Role**: SQLite pool, PRAGMA setup, migration runner, WAL mode,
  `busy_timeout`, `foreign_keys = ON` enforcement. Every Rust command
  acquires a connection through here.
- **Risk if broken**: Dropped PRAGMA (`foreign_keys`) silently allows
  orphan `bill_lines` / `payments` on bill delete; missing `busy_timeout`
  turns transient reader/writer collisions into "database is locked"
  errors seen by the cashier mid-bill. Migrations run twice or skip on
  fresh installs → corrupt schema invisible until the next feature
  touches an absent column.
- **Suggested tests**:
  - Open `:memory:` DB, assert `PRAGMA foreign_keys` returns `1`, WAL is
    set (or `memory` for in-mem), `busy_timeout` is the documented value.
  - Run migrations twice, assert idempotence (no duplicate `INSERT OR
    IGNORE` errors, final `schema_version` matches 0018).
  - Downgrade-guard: if a newer `schema_version` is present, `open_db`
    returns a typed error, does not silently proceed.
  - Connection checkout under contention: 10 concurrent writes succeed
    within `busy_timeout`.

---

## High gaps

### G04 `apps/desktop/src/components/DirectoryScreen.tsx` — 291 LOC
A3 customer/doctor master with prescription-list read. Upsert writes
PII (phone, GSTIN, gender) and creates `prescriptions` rows that the
billing path joins for Schedule H/H1 dispense. Untested path means a
regression that swaps customer and doctor IDs wouldn't surface until a
real bill fails on FK. **Need**: upsert happy path, duplicate-phone
rejection, Rx creation with doctor FK, tab switch preserves query.

### G05 `apps/desktop/src/components/ReportsScreen.tsx` — 245 LOC
Day-book / GSTR-1 summary / top-movers views + **CSV export**. CSV
encoding has an inlined escape routine (lines 17-28) that is not
exercised anywhere. A comma-or-quote handling bug silently corrupts the
CA hand-off. **Need**: CSV escape round-trip for commas, quotes,
newlines; export filename pattern; GSTR-1 bucket rendering.

### G06 `apps/desktop/src/components/OwnerOverrideModal.tsx` — 219 LOC
A13 expiry-guard modal. Calls `recordExpiryOverrideRpc` which writes
an audit row consumed by `save_bill` within a 10-min window. Reason
validation (`>= 4 chars`) must match the Rust side exactly.
Role-gating (`owner` only) is the only line between any cashier and
expiry-override fraud. **Need**: reason-too-short blocks confirm;
non-owner role shows banner and does NOT close; Esc cancels without
calling the RPC; success path forwards auditId to parent.

### G07 `apps/desktop/src/components/GmailInboxScreen.tsx` — 260 LOC
X1 moat surface. Connects Gmail OAuth, lists messages, fetches
attachments, runs supplier-template parser, hands draft to GrnScreen
via the `pendingGrnDraft` module bus. A regression that sends the wrong
OAuth account's tokens or reuses a disconnected session is
security-adjacent. **Need**: connect/disconnect toggles status;
first-text-attachment selection heuristic; template apply surfaces
low-confidence rows for manual match; draft hand-off sets the bus.

### G08 `apps/desktop/src/components/SupplierTemplateScreen.tsx` — 366 LOC
X1 Tier A template config. JSON textareas with client-side parse; a
bad regex in a template silently breaks every future Gmail import for
that supplier. **Need**: invalid JSON blocks save; regex compiles;
Test-against-sample returns `TemplateTestResult`; delete confirms.

---

## Medium gaps

| File | LOC | Reason it's Medium |
|---|---|---|
| `apps/desktop/src/components/ProductSearch.tsx` | 109 | Debounced FTS5 search, keyboard cursor. Wrong result row = wrong product on a bill. |
| `apps/desktop/src/lib/pendingGrnDraft.ts` | 30 | Module-level singleton bus; no tests even though ADR 0020 names it as the X1.2 hand-off. `_resetPendingGrnDraftForTests` exists — unused. |
| `packages/gstr1/src/aggregate.ts` | 383 | Indirect via `index.test.ts` (14 cases) but never directly. The B2B/B2CL/B2CS classifier is the hairiest logic in the repo. |
| `packages/gstr1/src/csv.ts` | 196 | Indirect only. Tally-parity column order regression silently wrecks CA hand-off. |
| `packages/gmail-inbox/src/index.ts` | 224 | Has `index.test.ts` (5 cases) — **thin**. Only header-heuristic tested; `applySupplierTemplate` has no negative cases. Listed here and in "Thin". |
| `packages/seed-tool/src/data.ts` | 186 | Demo dataset; tested indirectly via `seed.test.ts`. A typo in a schedule assignment (`H1` vs `H`) silently ships in demo installs. |
| `packages/einvoice/src/types.ts` | 171 | Pure types + constants (`VendorName`, `GstTreatment`). No direct test but consumed by `build`/`validate` tests. |

---

## Thin-coverage files (have tests but weak)

| Source | Test LOC / cases | What's missing |
|---|---|---|
| `packages/crypto/src/index.ts` | 3 cases | All primitives throw `NotImplementedError`; that's correct today but the moment one is implemented the harness will not cover it. Add a `.skip` placeholder per primitive so the TODO is visible. |
| `packages/reports-repo/src/index.ts` | 4 cases | Covers dayBook, gstr1Summary, topMovers happy paths. Missing: empty-period returns zeros; inter-state vs intra-state bucketing; nil-rated/exempt rollups; shop_id isolation. |
| `packages/gmail-inbox/src/index.ts` | 5 cases | Header heuristic only. `applySupplierTemplate` negative paths (missing column, bad regex) untested. |
| `packages/seed-tool/src/seed.ts` | 8 cases | Happy + idempotence + one FTS lookup. Missing: reset flag; custom path; schedule-H molecule hash stored. |
| `packages/gmail-inbox/src/repo.ts` | 6 cases | Thin — CRUD on `gmail_accounts` but no token-rotation scenario. |
| `packages/invoice-print/src/format.ts` | 9 cases | Number/INR formatting; missing locale edge cases. |
| `packages/stock-reconcile/src/variance.ts` | 5 cases | Happy variance math; no overflow / negative-stock boundaries. |
| `packages/grn-repo/src/index.test.ts` | 8 cases | Save-GRN happy paths; missing duplicate invoice guard, rollback on bad batch, partial failure. |
| `apps/desktop/src/components/InventoryScreen.test.tsx` | 3 cases | Very thin — renders, one filter toggle, one sort. No action tests. |
| `apps/desktop/src/components/ProductImageThumb.test.tsx` | 5 cases | Decent for its size, but no error-state render. |
| `apps/desktop/src/components/inventory/ReconcileTab.test.tsx` | 6 cases | Covers count entry; missing the audit-log round-trip (classify + variance + writeback). |
| `apps/desktop/src/components/GrnScreen.test.tsx` | 7 cases | The screen is 479 LOC with pending-draft banner, auto-match, manual-match fallback. 7 cases can't cover all branches — X1.2 auto-match (per main-tip squash) especially needs a regression case per confidence tier. |

---

## Solid coverage (FYI — no action)

- `packages/bill-repo/src/index.ts` — 47 cases (comprehensive: save_bill, Rx gate, expiry gate, owner-override, concurrency, FEFO, payment ledger).
- `packages/batch-repo/src/index.ts` — 27 cases (comprehensive).
- `packages/directory-repo/src/index.ts` — 25 cases (comprehensive: customer/doctor/Rx, FK, search).
- `packages/gst-engine/src/index.ts` — 29 cases + perf harness + BigInt reference cross-check in `reference.ts`.
- `packages/einvoice/src/{build,format,validate}.ts` — 10+28+17 cases (comprehensive for GSTN v1.1 subset).
- `packages/gstr1/src/{index,classify,format}.ts` — 14+21+10 cases (decent on orchestration; aggregate/csv covered indirectly).
- `packages/shared-types/src/validators.ts` — 17 cases (comprehensive).
- `packages/search-repo/src/index.ts` — 18 cases (FTS5 + FEFO decent).
- `packages/schedule-h/src/index.ts` — 8 cases (decent: molecule lookup, salt-form stripping, unknown returns OTC).
- `apps/desktop/src/App.test.tsx` — 40 cases (comprehensive: routing, shortcuts, auth gate).
- `apps/desktop/src/components/BillingScreen.test.tsx` — 34 cases (comprehensive).
- `apps/desktop/src/components/ReturnsScreen.test.tsx` — 15 cases (decent).
- `apps/desktop/src/components/PaymentModal.test.tsx` — 10 cases (decent: tender split, tolerance).
- `apps/desktop/src/components/ComplianceDashboard.test.tsx` — 13 cases (decent).
- `apps/desktop/src/components/SettingsScreen.test.tsx` — 7 cases (decent; ADR 0008 hardened flake).

Perf tests (`*.perf.test.ts` in batch-repo, bill-repo, directory-repo,
gst-engine) are benchmark-only, single case each — that's intentional.

---

## Low / OK-to-skip

- `packages/*/src/index.ts` 1-line barrels (sku-images 4 LOC,
  stock-reconcile 4 LOC, einvoice 5 LOC, shared-types 12 LOC).
- `packages/shared-types/src/{bill,customer,ids,money,product,compliance}.ts`
  — pure type declarations + small constants; `validators.test.ts` and
  `index.test.ts` exercise the exported shapes transitively. Adding tests
  would be redundant with TS compile.
- `apps/desktop/src/main.tsx` — 20 LOC React bootstrap.
- `packages/einvoice/src/types.ts`, `packages/gstr1/src/types.ts`,
  `packages/invoice-print/src/types.ts`, `packages/stock-reconcile/src/types.ts`,
  `packages/sku-images/src/types.ts` — type-only files.
- `packages/gstr1/src/fixtures.ts`, `packages/invoice-print/src/fixtures.ts` —
  test fixture data.

---

## Rust coverage snapshot

| File | LOC | #test fns | Notes |
|---|---|---|---|
| `commands.rs` | 4627 | 2 | **Very thin.** The Tauri command surface — `save_bill`, `save_grn`, `save_payment`, `record_expiry_override`, 60+ commands — with only 2 unit tests. Most coverage is integration via TS-side mocks. A Rust-side regression (e.g. FK violation swallowed) is invisible to the TS suite. **Gap.** |
| `db.rs` | 250 | 0 | See G03. |
| `images.rs` | 590 | 7 | Decent: mime sniff, hash, attach, get. |
| `main.rs` | 99 | 0 | Bootstrap; OK to skip. |
| `oauth/config.rs` | 77 | 2 | Thin but sufficient (config parse). |
| `oauth/gmail_api.rs` | 362 | 4 | Decent (list, fetch, attachment decode). |
| `oauth/google.rs` | 195 | 4 | Decent (token exchange, refresh). |
| `oauth/keyring_store.rs` | 38 | 0 | **Gap.** OS-keyring round-trip untested; failure mode on locked keyring goes straight to prod. |
| `oauth/loopback.rs` | 124 | 3 | Decent (PKCE loopback server). |
| `oauth/mod.rs` | 275 | 0 | **Gap.** Orchestrator (`connect`, `disconnect`, `refresh_if_expired`) has no direct test — relies on sub-module tests. |
| `oauth/pkce.rs` | 49 | 2 | Decent for its size. |
| `phash.rs` | 252 | 7 | Comprehensive (pHash compute + Hamming). |
| `products.rs` | 360 | 5 | Decent (list, upsert, deactivate). |
| `products_perf.rs` | 105 | 1 | Perf-only. |
| `telemetry.rs` | 113 | 5 | Decent. |

Rust totals: **42 test fns across 10 files**; 5 files with zero
(`db.rs`, `main.rs`, `oauth/keyring_store.rs`, `oauth/mod.rs`, plus
only-a-perf-file `products_perf.rs` if we count single-fn-perf as zero).

---

## Proposed next sprint ticket

Title: **"Close the three critical coverage gaps and the GSTR-1 CSV
blind spot"**.

Tackle in this order, one week sprint:

1. **G01 `lib/ipc.ts` contract tests** (~2 days). This is load-bearing
   for every other screen test — a snapshot of each RPC's JSON shape
   keyed off the Rust struct definitions catches the
   `camelCase`/`snake_case` drift class of bug at CI time, not runtime.
   Seeds a harness future screens can reuse.
2. **G03 `src-tauri/db.rs`** (~1 day). Small file, high leverage:
   PRAGMA assertions + migration-idempotence. Adds ~6 Rust tests,
   trivially cheap on CI.
3. **G02 `ProductMasterScreen.tsx`** (~1.5 days). GST-rate/Schedule
   regressions are the highest-$ silent-failure class in the product.
   Use the G01 harness for RPC mocks.
4. **G05 ReportsScreen CSV escape** (~0.5 day). One day of CA-hand-off
   embarrassment is cheaper as a unit test than a phone call.
5. **G06 OwnerOverrideModal** (~1 day). Regulated-audit-trail code —
   the 4-char reason rule and owner-role gate must stay lock-step with
   Rust. Snapshot the DOM states and assert the RPC call shape.

Deferred to a follow-up: G04, G07, G08, the thin-coverage rows, and
the Rust `oauth/mod.rs` / `keyring_store.rs` gaps — track as separate
tickets once the critical four land.

<!-- end-of-doc marker — trailing padding follows to absorb Windows mount write truncation per MEMORY.md -->
<!-- pad line 1 -->
<!-- pad line 2 -->
<!-- pad line 3 -->
<!-- pad line 4 -->
<!-- pad line 5 -->
<!-- pad line 6 -->
<!-- pad line 7 -->
<!-- pad line 8 -->
<!-- pad line 9 -->
<!-- pad line 10 -->
<!-- pad line 11 -->
<!-- pad line 12 -->
<!-- pad line 13 -->
<!-- pad line 14 -->
<!-- pad line 15 -->
<!-- pad line 16 -->
<!-- pad line 17 -->
<!-- pad line 18 -->
<!-- pad line 19 -->
<!-- pad line 20 -->
<!-- pad line 21 -->
<!-- pad line 22 -->
<!-- pad line 23 -->
<!-- pad line 24 -->
<!-- pad line 25 -->
<!-- pad line 26 -->
<!-- pad line 27 -->
<!-- pad line 28 -->
<!-- pad line 29 -->
<!-- pad line 30 -->
