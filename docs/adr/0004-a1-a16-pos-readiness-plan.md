# ADR 0004 — A1–A16 POS readiness plan (Vaidyanath pilot gate)

- Status: Accepted
- Date: 2026-04-15
- Supersedes: none
- Related: ADR 001 (Turborepo), ADR 002 (SQLite schema runtime), ADR 0001 (X1 Gmail→GRN), ADR 0002 (Gmail OAuth), ADR 0003 (oauth_accounts + quota)

## Context

Foundation F1–F7 is shipped at commit `de9ce0f` on `main`: monorepo + Tauri
shell + SQLite runtime + migration framework + settings bootstrap + Gmail
OAuth + oauth_accounts audit/quota. The next milestone is **the first real
bill at Vaidyanath Pharmacy, Kalyan** — Month-3 exit gate per Playbook v2.0
§8.9 (Phase 0 → Phase 1).

The 10 Hard Rules (§2) are binding on every branch below. Specifically for
A-series:

- Sub-2s bill on Win7 / 4 GB / HDD → every A-branch must measure.
- Keyboard shortcut for every high-frequency action → no mouse-only flow.
- FEFO enforced, expired-sale hard-blocked → A2 + A13 are non-negotiable.
- Compliance automatic (GST, Schedule H/H1/X, NPPA cap) → A4 + A7.
- LAN-first, desktop works 100 % offline → A14 is a gate, not a stretch.

A-series is the **billing counter** — it intentionally excludes X1/X2/X3,
GRN/PO, franchise parent/worker split, and cloud bridge. Those are B/C-series
and are sequenced after pilot Day-30 green.

## Decision

Cut 16 feature branches off `main`, named `feat/a1-<slug>` … `feat/a16-<slug>`,
merged in dependency order via squash-PR. Each branch ships with: migration
(if schema), Rust service + gRPC/Tauri command, React slice + keyboard map,
Vitest + cargo test, and a perf probe logged to `perf/` for A15 aggregation.

### Scope, order, dependencies, acceptance

| # | Branch | Scope (one line) | Depends on | Acceptance gate |
|---|---|---|---|---|
| A1 | `feat/a1-sku-master` | `products` table + HSN + Schedule flag + NPPA cap field; CRUD commands + React master screen | F5 settings, ADR 002 schema | 200-SKU seed loads in <500 ms; HSN 3003/3004 validator rejects bad codes; Schedule flag persisted; unit + e2e green |
| A2 | `feat/a2-batch-stock` | `batches` table (batch_no, expiry, mrp, purchase_rate, qty_on_hand) with FEFO composite index `(product_id, expiry_date, batch_no)`; stock-movement ledger | A1 | FEFO query returns oldest-non-expired batch in <5 ms on 50 k rows; movement ledger double-entry balances; expired rows excluded from pickable view |
| A3 | `feat/a3-customer-master` | `customers` table (phone-indexed), walk-in default row, doctor registry for Rx | A1 | Phone lookup p95 <10 ms on 10 k rows; walk-in auto-selected when F2 skipped; doctor reg-no format validator |
| A4 | `feat/a4-tax-engine` | `packages/gst-engine` — CGST/SGST/IGST split, inter/intra-state detection, NPPA ceiling check, round-off rule | A1 | Golden-test suite (100 bills from real pharmacy invoices) matches to paisa; NPPA cap breach blocks save with reason code |
| A5 | `feat/a5-billing-shell` | Keyboard-first React billing screen skeleton; F-key map (F1 new, F2 customer, F3 add-line, F4 discount, F6 payment, F10 save); focus-ring contract; no mouse required | A1,A2,A3,A4 | Keyboard-only creation of empty bill in <2 s measured; focus never lost to mouse; a11y audit clean |
| A6 | `feat/a6-bill-core` | `bills` + `bill_lines` tables; line-add with FEFO auto-pick, manual batch override (F7), qty/disc/free-qty; in-memory recompute on every keystroke | A2,A4,A5 | 10-line bill computed and saved in p95 <400 ms on reference hardware (i3-8100/4 GB/HDD); FEFO auto-pick verified; NPPA + GST re-check on save |
| A7 | `feat/a7-rx-capture` | Schedule H/H1/X prompt — doctor, reg-no, patient, Rx date; optional photo via webcam; writes to `rx_records` with 2-year retention flag; hard-block save if required-and-missing | A3,A6 | Schedule-H line triggers modal; save blocked without Rx fields; `rx_records` survives 2-year retention migration dry-run |
| A8 | `feat/a8-payment` | Payment modal — cash/card/UPI/credit, split tender, change calc, round-off to tax-engine rule | A6 | Split tender (3 modes) balances to bill total; round-off matches A4 golden test; F6→F10 flow <600 ms |
| A9 | `feat/a9-invoice-print` | GST-compliant invoice: 3-inch thermal + A5 laser templates; Handlebars-driven; print-preview F9; shop letterhead from F5 settings | A7,A8 | Thermal template passes 3-inch Epson/TVS simulator; A5 template matches CBIC rule-46 fields; PDF snapshot diff-test green |
| A10 | `feat/a10-returns-cn` | Return/credit-note flow — pick original bill, select lines, reason code, restock to original batch, GST reversal via A4 | A9 | CN number sequential + non-colliding; stock restored to correct batch (verified via A2 ledger); GST reversal journal balances |
| A11 | `feat/a11-day-close` | Cash drawer open/close, denomination count, Z-report (sales, returns, tender-mix, Schedule-H count); locks further bills on close | A9,A10 | Z-report tender-mix == sum of payments in window; close→reopen requires supervisor PIN; discrepancy field persisted |
| A12 | `feat/a12-gst-exports` | GSTR-1 JSON (B2B/B2C/HSN summary), daily CSV, outward register; uses `packages/gst-engine` serializers | A9,A10 | GSTR-1 JSON validates against CBIC offline utility; HSN summary reconciles to bill-line totals to paisa |
| A13 | `feat/a13-expiry-guard` | Near-expiry warning (90-day amber, 30-day red) on line-add; expired = hard block with override-by-owner audit log; NDPS Form-IV hook stub | A2,A6 | Expired batch cannot be sold under any role; near-expiry surfaces in <50 ms; override writes audit row with actor + reason |
| A14 | `feat/a14-offline-queue` | Worker-mode billing when parent unreachable: local SQLite remains authoritative, bills queued with monotonic clock, reconcile-on-reconnect; LAN failover <2 s | A9 | Kill parent mid-bill → worker completes, prints, queues; reconnect merges with zero duplicates on 500-bill fuzz; clock-skew resolver correct |
| A15 | `feat/a15-perf-harden` | Perf probe aggregator → `perf/report.json`; index + query tuning pass; cold-start <3 s; bundle-size budget; Win7/4 GB/HDD regression VM | A1–A14 | Cold-start <3 s, bill-save p95 <400 ms, LAN failover <2 s, installer <200 MB, resident <300 MB — all on reference VM; CI perf-gate added |
| A16 | `feat/a16-pilot-harness` | Pilot acceptance kit — 30-bill scripted run, parallel-run diff against Marg/Tally export, NPS survey stub, 48 h hotline runbook, onsite install checklist | A11,A12,A15 | 30-bill run produces zero-discrepancy report vs legacy export; install checklist dry-runs in <90 min on clean Win10; hotline runbook signed off |

### Branching + merge protocol

1. Branch off `main` at each start: `git checkout -b feat/aN-<slug>`.
2. One branch → one squash-PR → `main`. No stacked merges until A6.
3. Required CI: `cargo test`, `vitest run`, `cargo clippy -D warnings`,
   `turbo build`, perf probe (after A15 lands the gate).
4. Migrations numbered sequentially from 0006 onward; no migration is
   squashed or rewritten after merge.
5. Every branch adds its acceptance evidence under `/docs/evidence/aN/`
   (JSON perf dump, test run, screenshot). No merge without evidence.
6. Commit identity: `aivora017 <aivora017@gmail.com>` (not chat account).

### Parallelisation

Safe to parallelise once A1+A2+A3+A4 are on `main`:
- A5/A6 pair (single dev, sequential within pair).
- A7, A8, A13 can run in parallel after A6.
- A11, A12 parallel after A9+A10.
- A14 parallel from A9 onward (touches different layer).
- A15 is a cross-cutting finisher; A16 is the pilot gate.

### Out of scope (explicit)

Franchise parent/worker full split, X1 Gmail→GRN ingest, X2 SKU-image
enforcement end-to-end, X3 paper-bill OCR, cloud bridge, mobile apps,
analytics cube, AI copilot. All deferred to B/C-series post-pilot.

## Consequences

Positive:
- Clear, gated path to first billed prescription. Every branch has a
  measurable exit.
- Dependency graph allows up to 3 concurrent branches from A7 onward if
  headcount grows pre-pilot.
- Compliance + perf baked into merge criteria, not bolted on at the end.

Negative / accepted trade-offs:
- No GRN/PO in A-series means opening stock is bulk-imported via CSV for
  pilot Day-1 — acceptable for Vaidyanath (single shop, known SKUs).
- No X1/X2/X3 in A-series means the three moats are absent at first bill;
  this is intentional to protect the pilot-date gate.
- A14 (offline queue) before A15 (perf) means some perf work will re-touch
  worker paths — mitigated by A15 CI gate catching regressions.

## Alternatives considered

1. **Ship X1 before A-series.** Rejected: X1 without a working till is a
   moat with no castle. Pilot must bill first.
2. **Fewer, larger branches (A1–A6 merged into 3).** Rejected: violates
   review-sized PR norm; harder to revert a bad tax-engine commit without
   reverting billing.
3. **Cloud-hosted pilot for faster iteration.** Rejected by Hard Rule 1
   (LAN-first, desktop works 100 % offline).
4. **Defer A13 expiry guard to post-pilot.** Rejected: expired-drug sale
   is a Drugs & Cosmetics Act violation; cannot ship without it.

## Supersedes / superseded-by

Supersedes: none.
Superseded-by: (to be updated when B-series plan ADR lands post-pilot).
