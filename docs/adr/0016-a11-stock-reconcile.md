# ADR 0016 — A11 Stock Reconcile (Physical Count vs System Qty)

**Status:** Accepted
**Date:** 2026-04-17
**Deciders:** Sourav (founder), tech-lead
**Supersedes:** —
**Superseded-by:** —

## Context

Pharmacy shops discover that physical shelf stock drifts from system stock — shrinkage, mis-punched bills, GRN mis-entries, damaged/expired dumps not written off, home-deliveries not scanned back in. Without a first-class physical-count flow:

- Owners cannot trust `batches.qty_on_hand` for reorder points, GMP audits, or FEFO.
- Shrinkage is invisible — not attributable to a date, person, or SKU.
- Drug-inspector audits demand a reconciled register (D&C Rules 1945, Schedule H/H1/X registers).
- FEFO allocation (A1/A5) relies on `batches.qty_on_hand`; a stale number silently sells a different batch than what's on shelf.

The v2.0 Playbook §Inventory says "auto 3-way PO/GRN match; FEFO enforced; expired drug sale = hard block." A11 adds the fourth leg: **periodic physical reconcile**, audit-trailed, owner-signed-off.

Forces at play:

- LAN-first: the count must work offline; desktop sessions can last hours; interruption tolerance required.
- Keyboard-first: counters scan EAN / punch batch-code + qty; <2s per line.
- Compliance: every qty change needs a reason code + user_id + timestamp; immutable ledger entry.
- Multi-user: owner + staff may count different sections concurrently; merge before finalize.
- Batch-level: qty drift is almost always batch-specific (a particular strip mis-located), not SKU-level.

## Decision

Introduce **count sessions** as a first-class entity. One session = one physical-count cycle (e.g. "Month-end April 2026", "Aisle-3 spot-check 2026-04-17"). Within a session:

1. **Open session** (owner or staff). Writes `physical_counts` row: `id`, `shop_id`, `title`, `opened_by`, `opened_at`, `status='open'`.
2. **Record lines** (any role). Each line: `physical_count_id`, `batch_id`, `counted_qty`, `counted_by`, `counted_at`, `notes`. Unique on (physical_count_id, batch_id) — last-write wins within the same batch, but every mutation appends to an audit log inline (JSON `revisions` column, append-only).
3. **Preview variance**: pure-TS computes per-batch `variance = counted_qty − system_qty` with reason classification (shortage / overage / zero). Not-counted batches listed as "unscanned".
4. **Finalize** (owner-only). Writes one `stock_adjustments` row per non-zero variance batch with `reason_code`, decrements/increments `batches.qty_on_hand`, appends `stock_ledger` entries with `kind='adjust'` and `ref_id = stock_adjustments.id`. Session → `status='finalized'`, `finalized_by`, `finalized_at`.
5. **Immutable after finalize**: no further line edits; session stays readable.

Reason codes (enum, DB CHECK):
`shrinkage`, `damage`, `expiry_dump`, `data_entry_error`, `theft`, `transfer_out`, `other`.

UI placement: **tab inside `InventoryScreen` (Alt+2)**. All Alt+digit slots 0–9 are bound (see ADR 0009); Reconcile is a sub-view, not a new top-level screen. Tab key scheme inside Inventory: `B` Batches (default), `R` Reconcile.

F-keys inside ReconcileTab:
- `F2` Open new session
- `F4` Add line (scan batch code + qty)
- `F9` Preview variance (re-compute)
- `F12` Finalize (owner-gated, opens confirm modal)

## Options Considered

### Option A (chosen): Session + lines + adjustments, batch-level, owner-finalize-gate

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | 1 migration, 1 pure-TS pkg, ~4 Rust cmds, 1 UI tab |
| Scalability | O(n) per line; even 5000-batch count is instant |
| Team familiarity | Reuses A7/A9/A10 patterns — migration + package + IPC + tab |
| Audit | Full: `stock_adjustments` + `stock_ledger` + session header |
| Compliance | Satisfies D&C retention (append-only) + owner sign-off (Schedule H analog) |

**Pros:**
- Maps 1:1 to how pharmacists actually count (open, scan, review, lock).
- Variance preview gives a stop-and-think step before touching stock.
- Owner-gated finalize = fraud-resistant (staff cannot silently hide shrinkage).
- Reason codes power future "shrinkage dashboard" (phase 2).

**Cons:**
- Two-stage write (preview → finalize) is more code than "adjust one row at a time".
- Concurrent counters on the same batch need conflict resolution (accepted last-write-wins with revision log).

### Option B: Direct per-batch qty_on_hand override with audit row

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | 1 table (`stock_adjustments`), 1 Rust cmd |
| UX | Poor — no "session" mental model; forgets half-counted state on crash |
| Audit | Thin — no grouping of adjustments into a physical-count event |

**Rejected** — loses the session concept, can't resume a partially-done count after power-cut, can't ask "what did the April month-end reconcile find?"

### Option C: Defer to Phase 2, rely on GRN/bill adjustments only

**Rejected** — shrinkage stays invisible. GMP/FDA audits in Maharashtra explicitly ask for reconciled registers; deferring breaks the compliance claim.

### Option D: Full 3-way session (count → approve → post) like SAP/Marg

**Rejected** — over-engineered for single-owner pharmacy. The "approve" step is always the owner and happens immediately after preview.

## Trade-off Analysis

The core tension is **safety vs. speed**. Owners want one-screen count + commit; auditors want a paper trail. Option A reconciles both: staff can count all day without touching stock (safe), owner commits in one action with a confirm modal (fast).

Batch-level vs. SKU-level: we chose batch-level because FEFO demands batch precision. A SKU-level count that drops 6 units against product X silently picks the earliest-expiry batch to decrement, which may be wrong (the "missing" units may be from batch-B sitting on shelf while batch-A is gone). Batch-level count forces the shop to say *which batch* is short.

Last-write-wins on duplicate (session, batch) with revision JSON: simpler than optimistic concurrency; the append-only revisions column preserves full history if auditors ever ask. Concurrent edits on the same batch are rare (one aisle → one counter in practice).

## Consequences

What gets easier:
- FEFO allocation stays honest after a count.
- Owners can spot shrinkage hotspots (future dashboard reads `stock_adjustments` grouped by `reason_code` × date × product).
- Drug-inspector audits have a single "Reconcile Register" view.

What gets harder:
- Stock-ledger now has three write sources: bill_line (A1), GRN (later), adjustment (A11). Already factored — ledger table is generic.
- Multi-store (later): each shop counts independently; HQ rolls up. Nothing in A11 blocks that.

What we'll revisit:
- Phase 2: cycle-count recommendations (ML picks which aisles to count this week based on sales velocity).
- Phase 2: mobile owner-app to approve finalize from phone (A11 requires desktop owner session).

## Action Items

1. [x] Write this ADR (0016).
2. [ ] Migration 0015 — `physical_counts`, `physical_count_lines`, `stock_adjustments`; add `reason_code` enum CHECK; FK → `batches`.
3. [ ] `@pharmacare/stock-reconcile` pure-TS: `computeVariance`, `classifyReason`, `aggregateByProduct`, `validateSession`.
4. [ ] Rust cmds + IPC: `open_count_session`, `record_count_line`, `preview_count_variance`, `finalize_count` (owner-gated), `list_count_sessions`, `get_count_session`.
5. [ ] `ReconcileTab` inside `InventoryScreen`; F2/F4/F9/F12 bindings; tests.
6. [ ] Evidence pack in `docs/evidence/a11/`: migration diff, finalize audit trail sample, tests.
