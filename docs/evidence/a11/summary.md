# A11 Stock-Reconcile — Evidence Pack

- ADR: `docs/adr/0016-a11-stock-reconcile.md`
- Migration: `packages/shared-db/migrations/0015_a11_stock_reconcile.sql`
- Tables: `physical_counts`, `physical_count_lines`, `stock_adjustments`
- Pure-TS pkg: `@pharmacare/stock-reconcile` (20 tests: classify 6, variance 5, validate 9)
- Rust commands: open/record/get/finalize/cancel/list (6)
- UI: `InventoryScreen` → tabbed (Batches | Reconcile); ReconcileTab with F2/F4/F12
- Tests: ReconcileTab 6, InventoryScreen 3, total desktop delta +9

## Migration guard invariants verified

- adjustments append-only (UPDATE/DELETE blocked)
- qty_delta=0 rejected
- UNIQUE(session, batch) on both physical_count_lines and stock_adjustments
- invalid reason_code rejected (CHECK)
- counted_qty < 0 rejected (CHECK)
- lines frozen after session.status != 'open'
- status transitions monotonic (open → finalized/cancelled only)
- finalize requires finalized_by + finalized_at (CHECK)
- cancel requires cancelled_by + cancelled_at (CHECK)

## Tests green

- @pharmacare/stock-reconcile: 20/20
- desktop (InventoryScreen + ReconcileTab): 9/9
- full workspace: 699/699

## Reason-code classifier decisions (heuristic)

| Input                              | Suggested reason   |
|------------------------------------|--------------------|
| shortage on batch ≤30d from expiry | `expiry_dump`      |
| shortage ≥5 units AND >20% of qty  | `shrinkage`        |
| shortage ≤2 units OR ≤5% of qty    | `data_entry_error` |
| medium shortage                    | `shrinkage` (fallback) |
| overage                            | `data_entry_error` |
