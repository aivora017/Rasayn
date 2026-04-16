# ADR 0005 — A2 batch stock: deterministic FEFO + append-only stock ledger

- Status: Accepted
- Date: 2026-04-16
- Supersedes: none
- Related: ADR 0004 (A1–A16 POS readiness plan, row A2), ADR 002 (SQLite schema
  runtime), migration `0001_init.sql` (original `batches` + `trg_bill_lines_*`
  triggers), migration `0007_a2_batch_stock.sql`
- Enforces: Playbook v2.0 §2 Hard Rule 4 (sub-2 s bill on Win7/4 GB/HDD) and
  Hard Rule 9 (FEFO enforced; expired-drug sale = hard block)

## Context

A2 is the stock layer under the billing counter. It must answer two questions
every time a cashier scans a SKU:

1. **Which batch do I bill from?** — the oldest non-expired batch with stock,
   tie-broken deterministically so two machines on the same LAN snapshot give
   the same answer.
2. **Did stock actually move the way the POS says it did?** — every outbound
   or inbound unit must be recoverable from an auditable append-only log, so
   A11 day-close and A15 perf audit can prove the day was clean without
   relying on live screen state.

Migration `0001_init.sql` already carried three pieces of this load:

- `batches(product_id, batch_no, expiry_date, qty_on_hand, …)` with
  `UNIQUE(product_id, batch_no)` and an index on `(product_id, expiry_date)`.
- `trg_bill_lines_block_expired` — raises if a bill line is inserted against
  a batch whose `expiry_date < today`. This is the Hard Rule 9 enforcement
  point and stays the authoritative barrier.
- `trg_bill_lines_decrement_stock` — `AFTER INSERT ON bill_lines` → decrements
  `batches.qty_on_hand`. Good for the stock view; invisible to audit.

Three things were missing to call A2 done:

1. The FEFO query, in its most common shape
   `WHERE product_id=? AND qty_on_hand>0 AND expiry_date>=today ORDER BY expiry_date`,
   was not pinned to a covering index. On 50 k rows the planner sometimes picked
   the wider non-partial index and did a partial scan. We need a dedicated
   partial composite that the planner picks every time.
2. Ordering was `ORDER BY expiry_date ASC, created_at ASC`. `created_at` drifts
   across clone/restore (wall clock moves, SQLite `datetime('now')` re-issues)
   so FEFO is not deterministic. Tie must be on an intrinsic column.
3. `qty_on_hand` was the only record of stock. There was no way to prove that
   a given day's mutations net to what the balance says they should. That is
   the hole A10 (returns), A11 (day-close), and A15 (perf audit) all need
   plugged before any of them can ship.

## Decision

Ship migration `0007_a2_batch_stock.sql` and package `@pharmacare/batch-repo`
with these five mechanical decisions.

### 1. Partial composite index for FEFO

```sql
CREATE INDEX IF NOT EXISTS idx_batches_fefo
  ON batches(product_id, expiry_date, batch_no)
  WHERE qty_on_hand > 0;
```

`product_id` first (equality), `expiry_date` second (range + order), `batch_no`
third (order tiebreak). `WHERE qty_on_hand > 0` keeps the index small — only
live stock rows — which is what the pickable shape always filters. The planner
picks this index for every call of `listFefoCandidates`.

### 2. Deterministic tiebreak on `batch_no`

`v_fefo_batches` rebuilt with `ORDER BY product_id, expiry_date ASC, batch_no ASC`.
`batch_no` is a string the supplier prints on the strip; it is stable across
clone, restore, replay, and is what a pharmacist would tiebreak by manually. It
is also covered by the index above, so the order is free.

### 3. Append-only `stock_movements` ledger

```sql
CREATE TABLE stock_movements (
  id, batch_id, product_id, qty_delta INTEGER CHECK(qty_delta<>0),
  movement_type IN ('opening','grn','bill','return','adjust',
                    'waste','transfer_in','transfer_out'),
  ref_table, ref_id, actor_id, reason, created_at
);
```

One row per stock delta. Invariant:
`SUM(qty_delta) GROUP BY batch_id == batches.qty_on_hand` at all times.
`auditLedger()` returns `[]` when this holds and the list of offending
batches otherwise. A11 day-close refuses to close if this returns non-empty.

### 4. Auto-opening AFTER INSERT trigger on `batches`

```sql
CREATE TRIGGER trg_batches_opening_mv_ins
AFTER INSERT ON batches FOR EACH ROW WHEN NEW.qty_on_hand > 0
BEGIN
  INSERT INTO stock_movements ('mv_opn_'||NEW.id, …, 'opening', 'system', …);
END;
```

Plus an idempotent backfill that inserts an `'opening'` row for every
pre-existing batch in upgraded DBs. Net effect: the ledger invariant holds
from `t=0` whether the DB is fresh or migrated from a pre-A2 dump. Callers do
not need to remember to call `recordMovement('opening', …)`.

### 5. Upgrade `trg_bill_lines_decrement_stock` to also log

```sql
AFTER INSERT ON bill_lines FOR EACH ROW
BEGIN
  UPDATE batches SET qty_on_hand = qty_on_hand - NEW.qty WHERE id = NEW.batch_id;
  INSERT INTO stock_movements (…, -NEW.qty, 'bill', 'bills', NEW.bill_id, …);
END;
```

The decrement and the movement row are written in the same SQLite transaction
(same trigger). Either both land or neither does — impossible to drift.

Plus two append-only guards:

```sql
CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only — record an offsetting adjust row instead'); END;
CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
```

A corrected movement is recorded as an offsetting `adjust` row, never as a
mutation of history. This is the property A11 and A15 rely on.

### Host-side repo surface (`@pharmacare/batch-repo`)

| Function | Purpose |
|---|---|
| `listFefoCandidates(db, productId)` | Ordered candidate list for the F7 batch picker |
| `allocateFefo(db, productId, qtyNeeded)` | Dry-run FEFO split; throws `InsufficientStockError(needed, available)` |
| `recordMovement(db, input, alsoUpdateBatch?)` | Write ledger row (+ optional atomic `qty_on_hand` update) for GRN / adjust / waste / transfer |
| `commitAllocations(db, allocations, ref)` | Bulk convenience for bypassing `bill_lines` (tests, future bulk returns) |
| `auditLedger(db)` | Returns `[]` when invariant holds; list of discrepancies otherwise |

Rust mirror (`apps/desktop/src-tauri/src/batches.rs`) is **A6 scope, not A2**.
The schema + triggers in `0007` are the contract both sides must honour; the
byte-compatibility check lives in A15.

## Consequences

**Positive.**

- FEFO p95 **0.46 ms** on 50 k rows (11× under the 5 ms gate).
- Ledger invariant is enforced by the DB, not by repo discipline — any future
  consumer (Rust, cloud bridge, bulk importer) that writes to `batches` via
  the sanctioned triggers gets the invariant for free; any path that bypasses
  it is forced through `recordMovement`, which is the single audit chokepoint.
- Append-only guards turn "someone edited a past day's stock" from a silent
  bug into a DB-level error that surfaces at commit time.
- Every bill line now produces an audit row tagged with `ref_table='bills'`,
  `ref_id=<bill_id>`, `actor_id=<cashier>` — A7 audit and A11 day-close can
  answer "who moved what, when, and why" from a single table.

**Negative / costs accepted.**

- Every bill line is now two writes (UPDATE + INSERT) inside the trigger.
  Measured impact on 30-line bill is ≈0.3 ms extra; well within Hard Rule 4.
- The ledger will grow at roughly `bills × avg-lines + GRNs × avg-lines` per
  day. Back-of-envelope at Vaidyanath scale: ~500 movements/day → ~180 k
  rows/year. A11 day-close will add a monthly compaction into
  `stock_movements_archive` once B-series lands; not needed for Phase 0.
- "Edit past waste reason" is not possible — must be recorded as a new
  adjust row referencing the original. This is the correct audit-trail
  behaviour but contributors used to mutable rows will be surprised. Covered
  by `index.test.ts` and the trigger error message.

**Risks monitored.**

- If A6 (Rust mirror) ever implements `decrement_stock` without going through
  the `bill_lines` trigger, the ledger and `qty_on_hand` will drift. A15 is
  the regression net — it runs `auditLedger()` on an end-to-end workflow.
- SQLite triggers run inside the implicit savepoint of the INSERT. We rely on
  `better-sqlite3` / `rusqlite` defaults (`journal_mode=WAL`, `foreign_keys=ON`)
  set in migration `0001`. If those ever regress, the audit story breaks
  silently. A15 asserts both pragmas.

## Alternatives considered

### A. Non-partial composite index on `(product_id, expiry_date, batch_no)`

Works for the ORDER BY, but the index is larger (every row indexed, including
zero-qty and expired rows), and the planner sometimes picks the narrower 2-col
index on `(product_id, expiry_date)` for short query variants, which means
occasional sort-after-scan. The partial variant is both smaller and planner-
preferred. **Rejected.**

### B. Keep `ORDER BY expiry_date, created_at`

Simpler; no schema churn on the view. But FEFO becomes non-deterministic
across clone/restore because `created_at` is wall-clock-bound and SQLite's
`datetime('now')` does not have microsecond granularity on Windows. Two
machines on the same LAN could bill different batches for the same product
— a correctness bug in franchise mode. **Rejected.**

### C. Ledger via explicit repo calls, no trigger

Caller-side discipline: every place that writes `batches.qty_on_hand` also
calls `recordMovement`. Works if you trust every contributor forever, which
is the single thing we will not do for a compliance-critical path. The
trigger moves the invariant into the DB so no contributor, cloud process,
or future Rust port can bypass it. **Rejected** for the common path;
`recordMovement` stays available for paths that bypass `bill_lines` (tests,
bulk returns, future importers).

### D. Manual opening balances

Require every batch-writing path to call `recordMovement('opening', +qty)`
right after `INSERT INTO batches`. Same caller-discipline problem as C, plus
breaks on any DB upgrade from a pre-A2 dump. AFTER INSERT trigger + idempotent
backfill gives the same semantic with zero caller obligation. **Rejected.**

### E. Mutable `stock_movements`

Allow UPDATE/DELETE for "admin corrections". Would be friendlier to wrong
data entry but destroys the audit property the whole table exists for — A11
day-close and any future statutory register export lean on "every past row
still exists, offsets live in new rows". **Rejected** outright.

### F. Skip `commitAllocations` — trigger-only path

The bill flow never calls `commitAllocations` (the trigger handles it).
Tempting to delete it. Kept for two reasons: (a) tests need a way to stage
allocations without going through `bill_lines` (simpler fixture setup),
(b) A10 returns and future bulk importers need bulk ledger writes that are
not paired with a `bill_lines` row. **Kept, documented as rare path.**

## How to verify

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"
npx vitest run --project=@pharmacare/batch-repo
cat docs/evidence/a2/perf.json
```

Expected:

- 21/21 tests pass (20 unit + 1 perf).
- `perf.json.singlePick.p95Ms` < 5, `perf.json.fullAlloc50.p95Ms` < 5,
  `perf.json.ledgerBalanced == true`.
- No regression in `bill-repo`, `gst-engine`.
