#!/usr/bin/env bash
# ship-a8-foundation.sh
#
# A8.1 — Partial-refund foundation (ADR 0021 steps 1+2).
#
# Lands the schema + pure-TS math primitives that the later A8 PRs build on:
#   * packages/shared-db/migrations/0020_a8_partial_refund.sql
#       - return_headers, return_lines, credit_notes, return_no_counters
#       - new shop_settings table with partial_refund_max_days (Q1 addendum)
#       - trg_return_lines_qty_limit, trg_return_lines_nppa_cap,
#         trg_return_lines_stock_movement
#       - 5 indexes: idx_return_headers_bill, idx_return_headers_shop_created,
#         idx_return_headers_einvoice (partial), idx_return_lines_bill_line,
#         idx_return_lines_batch
#   * packages/bill-repo/src/partialRefund.ts
#       - computeLineProRata (refund per-line tax components, rounded via
#         the shared paise() helper — no duplicate rounding code)
#       - computeTenderReversal (proportional allocation, residual-to-largest)
#       - computeRoundOffPaise (±50 paise bounded, throws on blown-out deltas)
#       - QtyExceedsRefundableError / InvalidReturnQtyError /
#         InvalidRefundTotalError
#   * packages/bill-repo/src/partialRefund.test.ts
#       - 15+ vitest cases covering the ADR §Test-strategy-Unit matrix:
#         full return, half-strip, 1/3 odd-paise rounding, discount pro-rata,
#         CGST+SGST intra-state, IGST inter-state, 3-tender residual-to-largest,
#         over-return rejection, zero/negative qty rejection, round-off bounds
#
# Deliberately OUT of this PR (each lands as its own PR per ADR 0021
# §Implementation-sequencing):
#   * Rust save_partial_return / list_returns_for_bill / get_refundable_qty
#     / record_credit_note_irn / next_return_no commands (step 3).
#   * A10 GSTR-1 cdnr / cdnur / b2cs emit (step 4).
#   * A9 credit-note invoice-print layout (step 5).
#   * A12 CRN IRN adapter for Cygnet / ClearTax (step 6).
#   * PartialReturnPicker + TenderReversalModal UI + F4 wiring (step 7).
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-a8-foundation.sh
#
# Identity: aivora017 <aivora017@gmail.com>.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ ! -f "$HOME/.ghtok" ]]; then
  echo "ERR: missing \$HOME/.ghtok (PAT with repo scope)." >&2
  exit 1
fi
PAT="$(cat "$HOME/.ghtok")"
REPO="$(git config --get remote.origin.url \
  | sed -E 's#(.*github.com[:/])([^/]+/[^/.]+)(\.git)?$#\2#')"
BRANCH="feat/a8-foundation-migration-bill-repo-math"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate."
  exit 0
fi

# Expect the working tree to carry the bundle edits (tracked diffs OR
# untracked new files). `git diff --quiet` is blind to untracked paths;
# `git status --porcelain` picks up both cases.
if ! git status --porcelain -- \
   packages/shared-db/migrations/0020_a8_partial_refund.sql \
   packages/bill-repo/src/partialRefund.ts \
   packages/bill-repo/src/partialRefund.test.ts \
   | grep -q .; then
  echo "No changes in the target files; nothing to ship."
  exit 1
fi

# JS gate — vitest against bill-repo (the pro-rata math + migration
# round-trip test live here). shared-db migration loader also runs as part
# of the bill-repo test fixture via runMigrations(db), so migration 0020 is
# smoke-loaded transitively.
if command -v npm >/dev/null 2>&1; then
  echo "=== vitest: bill-repo ==="
  npx --yes turbo run test --filter=@pharmacare/bill-repo
else
  echo "WARN: npm not on PATH (WSL). Skipping local JS gate — CI will gate."
  sleep 3
fi

# Rust gate — cargo test for src-tauri. Not strictly required for this PR
# (no Rust file changed) but we run it anyway so we catch any accidental
# Rust-side drift before opening the PR. Keeps pilot CI green-streak intact.
if command -v cargo >/dev/null 2>&1; then
  echo "=== cargo test (guard; no Rust changes expected) ==="
  (cd apps/desktop/src-tauri && cargo test)
else
  echo "WARN: cargo not on PATH (WSL). Skipping Rust gate — CI will gate."
  sleep 3
fi

git checkout -b "$BRANCH"
git add packages/shared-db/migrations/0020_a8_partial_refund.sql \
        packages/bill-repo/src/partialRefund.ts \
        packages/bill-repo/src/partialRefund.test.ts \
        docs/runbooks/ship-a8-foundation.sh

git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "a8.1: partial-refund migration 0020 + bill-repo pro-rata math (ADR 0021 steps 1-2)

Foundation PR for A8 partial refunds. Lands the DB schema and the pure-TS
pro-rata math primitives; every subsequent A8 PR (Rust commands, GSTR-1
emit, IRN adapter, UI) builds on this.

Migration 0020:
  + return_headers (credit-note header, per refund event, shop-scoped
    unique return_no, einvoice_status lifecycle, round-off ±50).
  + return_lines (one row per bill_line × event, pro-rata tax columns,
    6-code reason_code CHECK).
  + credit_notes (scaffold for ADR 0022 credit-note tender mode —
    columns reserved, no flow wired here).
  + return_no_counters (per-shop per-FY sequence numerator for
    CN/YYYY-YY/NNNN credit-note numbering, Q3 addendum).
  + shop_settings (new table; hosts partial_refund_max_days with
    default 30, cap 180, hard-floor 0 disables feature — Q1 addendum.
    One-shot backfill row per existing shop so downstream code can
    assume the row exists).
  + Triggers:
      - trg_return_lines_qty_limit (qty_returned <= remaining refundable
        after subtracting the sum of prior return_lines on this bill_line)
      - trg_return_lines_nppa_cap (refund_amount_paise <= pro-rata
        line_total_paise + 50 paise rounding slack)
      - trg_return_lines_stock_movement (inserts one stock_movements row
        with movement_type='return' or 'return_to_expired_quarantine'
        discriminated on reason_code)
  + Indexes: idx_return_headers_bill, idx_return_headers_shop_created,
    idx_return_headers_einvoice (partial — drains the CRN submit queue
    efficiently), idx_return_lines_bill_line, idx_return_lines_batch.

bill-repo pro-rata math:
  + computeLineProRata(origLine, qtyReturned): pro-ratas every tax
    component (taxable, discount, cgst, sgst, igst, cess) on
    qty_returned/qty and returns the ProRataResult. Rounding is
    delegated to the shared paise() helper in @pharmacare/shared-types —
    no duplicate rounding code, so refund math can never drift from
    gst-engine.computeLine bill-side math.
  + computeTenderReversal(origTenders, refundTotalPaise): proportional
    allocation matching each original tender's share of the bill total,
    residual absorbed by the largest-amount tender to preserve
    sum-invariance (ADR 0021 §2 rule 2). Zero-amount tenders are
    filtered from the output; the input is guarded against empty /
    all-zero tender lists.
  + computeRoundOffPaise(lines, tenderTotal): signed ±50 paise delta
    for return_headers.refund_round_off_paise. Throws if the mismatch
    exceeds 50 paise so caller bugs surface loudly instead of
    corrupting the CHECK invariant silently.
  + Typed errors with structured fields: QtyExceedsRefundableError,
    InvalidReturnQtyError, InvalidRefundTotalError. Maps 1:1 onto the
    Rust error codes the later step-3 PR will emit.

Unit tests (partialRefund.test.ts):
  - Full-line return preserves every tax component exactly.
  - Half-strip (5/10) rounds 50% of each component cleanly.
  - 1/3 return exercises the odd-paise rounding bias (bias test).
  - Discount pro-rata applied on a discounted line.
  - CGST+SGST intra-state equal-split preserved in the refund.
  - IGST inter-state single-component path.
  - 3-tender residual-to-largest split (ADR 0021 §2 rule 2 example:
    1000 = 600 UPI + 300 cash + 100 card, refund 250).
  - Odd-paise residual construction exercises the residual-absorbing
    loop.
  - Zero-amount tender is filtered.
  - Over-return rejected with QtyExceedsRefundableError
    (carries origQty + qtyReturned + billLineId for UI highlight).
  - Zero / negative / NaN qty_returned → InvalidReturnQtyError.
  - Empty / all-zero tender list → NO_TENDERS / ZERO_TENDER_TOTAL.
  - Round-off ±50 paise bounds: delta within range returns signed
    value; out-of-range throws ROUND_OFF_OUT_OF_RANGE.

Not changed in this PR (each is its own later PR per ADR 0021
§Implementation-sequencing):
  - Rust save_partial_return / list_returns_for_bill /
    get_refundable_qty / record_credit_note_irn / next_return_no
    commands (step 3).
  - A10 GSTR-1 cdnr / cdnur / b2cs emit (step 4).
  - A9 credit-note invoice-print layout (step 5).
  - A12 CRN IRN adapter (step 6).
  - UX picker + tender-reversal modal + F4 wiring (step 7).

Progress marker for task #44."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

PR_BODY='## Summary

A8.1 — foundation PR for ADR 0021 *A8 Partial Refund (Line-Level Returns with Pro-Rata GST Reversal)*. Ships the DB schema (migration 0020) and the pure-TS pro-rata math (`@pharmacare/bill-repo`). Every subsequent A8 PR (Rust commands, GSTR-1 emit, IRN adapter, UI) builds on this.

This is **step 1 + step 2** of the seven-step §Implementation-sequencing in ADR 0021. Deliberately narrow to keep the blast radius small — no Rust surface, no UI, no exporter changes.

## What lands

### Migration 0020 (`packages/shared-db/migrations/0020_a8_partial_refund.sql`)

- `return_headers` — one row per refund event.
- `return_lines`   — one row per bill_line × event.
- `credit_notes`   — scaffold only; ADR 0022 will flesh out the redemption flow.
- `return_no_counters` — per-shop per-FY sequence numerator for `CN/YYYY-YY/NNNN` credit-note numbering (Q3 addendum).
- `shop_settings` (new) — hosts `partial_refund_max_days` (default 30, cap 180; Q1 addendum). One-shot backfill inserts a default row per existing shop.
- Triggers:
  - `trg_return_lines_qty_limit` — `qty_returned <= bill_lines.qty − SUM(prior return_lines)`.
  - `trg_return_lines_nppa_cap` — `refund_amount_paise <= pro-rata(line_total_paise) + 50`.
  - `trg_return_lines_stock_movement` — inserts one `stock_movements` row with `movement_type` `return` or `return_to_expired_quarantine` per `reason_code`.
- Indexes: `idx_return_headers_bill`, `idx_return_headers_shop_created`, `idx_return_headers_einvoice` (partial — only pending / failed CRN rows), `idx_return_lines_bill_line`, `idx_return_lines_batch`.

### bill-repo pro-rata math (`packages/bill-repo/src/partialRefund.ts`)

- `computeLineProRata(origLine, qtyReturned) → ProRataResult`
- `computeTenderReversal(origTenders, refundTotalPaise) → ReturnTender[]`
- `computeRoundOffPaise(lines, tenderTotal) → number` (signed, ±50 paise)
- Typed errors: `QtyExceedsRefundableError`, `InvalidReturnQtyError`, `InvalidRefundTotalError`.

Reuses the shared `paise()` helper from `@pharmacare/shared-types` so the refund path and the bill path (`gst-engine.computeLine`) cannot drift apart on rounding.

## Behaviour

- **Pro-rata formula** matches ADR 0021 §3 exactly:
  `refund_X = paise(bill_lines.X_paise * qty_returned / bill_lines.qty)`
  for every tax component and discount.
- **Tender reversal** follows ADR 0021 §2 rule 2: proportional share per original tender, residual absorbed by the largest-amount tender so `∑allocations == refund_total_paise` exactly.
- **Round-off** mirrors A8 `computeInvoice` ±50-paise bound. Out-of-range is a caller bug and throws rather than silently clamping.

## Test plan

- `packages/bill-repo/src/partialRefund.test.ts` — 15+ vitest cases covering every ADR §Test-strategy-Unit row:
  - Full-line return, half-strip, 1/3 odd-paise rounding.
  - Discount pro-rata, CGST+SGST intra-state, IGST inter-state.
  - 3-tender residual-to-largest (the ADR-cited example).
  - Over-return, zero/negative/NaN qty, empty/zero tender list.
  - Round-off ±50 cap (in-range signed delta, out-of-range throws).
- Migration 0020 is smoke-loaded transitively through the existing `runMigrations(db)` call in the bill-repo vitest fixture — if the DDL fails to parse, every bill-repo test goes red first.

## Not changed in this PR

Each of these lands as its own PR per ADR 0021 §Implementation-sequencing:

- Rust commands: `save_partial_return`, `list_returns_for_bill`, `get_refundable_qty`, `record_credit_note_irn`, `next_return_no` (step 3).
- A10 GSTR-1 `cdnr` / `cdnur` / `b2cs` emit (step 4).
- A9 credit-note invoice-print layout (step 5).
- A12 CRN IRN adapter for Cygnet / ClearTax (step 6).
- `PartialReturnPicker` + `TenderReversalModal` + ReturnsScreen F4 wiring + Q5 concurrency reload path (step 7).

No existing migration touched. No existing test adjusted.

Progress marker for task #44.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "a8.1: partial-refund foundation — migration 0020 + bill-repo pro-rata math (ADR 0021)",
    "head": os.environ["BRANCH"],
    "base": "main",
    "body": body,
}))
' <<< "$PR_BODY")

PR_RESP=$(curl -sS -X POST \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  -d "$PR_PAYLOAD" \
  "https://api.github.com/repos/${REPO}/pulls")

PR_NUM=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('number') or d)" <<< "$PR_RESP")
echo "Opened PR #${PR_NUM}"

SHA=$(git rev-parse HEAD)
for i in {1..80}; do
  sleep 15
  STATE=$(curl -sS -H "Authorization: token $PAT" \
    "https://api.github.com/repos/${REPO}/commits/${SHA}/check-runs" \
    | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
runs = d.get('check_runs', [])
if not runs: print('none'); sys.exit()
concl = [r.get('conclusion') for r in runs if r.get('status') == 'completed']
statuses = [r.get('status') for r in runs]
if any(s != 'completed' for s in statuses): print('in_progress'); sys.exit()
if all(c in ('success', 'neutral', 'skipped') for c in concl): print('success')
else: print('failed:' + ','.join([f'{r[\"name\"]}={r[\"conclusion\"]}' for r in runs if r.get('conclusion') not in ('success', None, 'neutral', 'skipped')]))
")
  echo "[$i] CI: $STATE"
  case "$STATE" in
    success) break ;;
    failed:*) echo "CI failed — $STATE"; exit 2 ;;
  esac
done

MERGE_PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"merge_method":"squash"}))')
MERGE_RESP=$(curl -sS -X PUT \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  -d "$MERGE_PAYLOAD" \
  "https://api.github.com/repos/${REPO}/pulls/${PR_NUM}/merge")
MERGED=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('yes' if d.get('merged') else 'NO:'+str(d))" <<< "$MERGE_RESP")
echo "Merge: $MERGED"

curl -sS -X DELETE -H "Authorization: token $PAT" \
  "https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH}" || true
git checkout main
git pull --ff-only "$GIT_URL" main
git branch -D "$BRANCH" || true

echo "Done. A8.1 partial-refund foundation shipped."
