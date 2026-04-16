# A2 Batch Stock + FEFO + Ledger — hand-off

Branch target: `feat/a2-batch-stock`
Baseline: `1917fb4` on `main` (CI fix commit — A1 merged at `1b631c46`)
ADR: `docs/adr/0005-a2-batch-stock-ledger.md` (also referenced in `0004` row A2)

## What's in this changeset

| Layer | File | Purpose |
|---|---|---|
| Migration | `packages/shared-db/migrations/0007_a2_batch_stock.sql` | Partial FEFO index, re-worked `v_fefo_batches`, `stock_movements` append-only ledger, opening-balance backfill + AFTER INSERT trigger, upgraded `trg_bill_lines_decrement_stock`, append-only guard triggers |
| Package (new) | `packages/batch-repo/package.json` + `tsconfig.json` | Workspace package `@pharmacare/batch-repo` |
| Repo (host) | `packages/batch-repo/src/index.ts` | `allocateFefo`, `listFefoCandidates`, `recordMovement`, `commitAllocations`, `auditLedger`, `InsufficientStockError` |
| Tests | `packages/batch-repo/src/index.test.ts` | 20 unit tests — FEFO order, tiebreak, expired-hard-block, ledger invariant, trigger contract, append-only guards |
| Perf gate | `packages/batch-repo/src/perf.test.ts` | 50 k-row FEFO perf probe; writes `docs/evidence/a2/perf.json` |
| Workspace | `vitest.workspace.ts` | Register `packages/batch-repo` |

## Acceptance gate — ADR 0004 row A2

| Gate | Target | Result |
|---|---|---|
| FEFO query p95 on 50 k rows | < 5 ms | **0.46 ms** (11× headroom, single-batch pick) |
| FEFO full allocation (qty=50) p95 | < 5 ms | **0.42 ms** |
| Ledger double-entry balance (auditLedger() == []) | balanced | **balanced** |
| Expired rows excluded from pickable view | hard-block | **enforced by `trg_bill_lines_block_expired` (0001) + `v_fefo_batches` date filter + repo-side filter** |

Evidence: `docs/evidence/a2/perf.json` (auto-written by `perf.test.ts`).

## Sandbox gate results (2026-04-16, this session)

| Gate | Result |
|---|---|
| `npx vitest run --project=@pharmacare/batch-repo` | **21/21** (20 unit + 1 perf) |
| `npx vitest run --project=@pharmacare/bill-repo` | 5/5 (no regression on bill-line trigger contract) |
| `npx vitest run --project=@pharmacare/gst-engine` | 12/12 (no regression) |
| Migration 0007 applies cleanly from fresh + from `0006` baseline | ok |
| `cargo test` + `clippy` + `fmt` | **pending — must run on Windows side; Rust side of A2 (batches.rs) is A6 scope, not A2** |

## Local gate sequence (run on Windows side)

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"

# make sure A1's CI fix commit is pushed first
git log --oneline origin/main..main     # should show 1917fb4 at minimum
git push origin main                    # push the CI fix

# A2 branch
git checkout -b feat/a2-batch-stock
git add packages/shared-db/migrations/0007_a2_batch_stock.sql `
        packages/batch-repo `
        vitest.workspace.ts `
        docs/adr/0005-a2-batch-stock-ledger.md `
        docs/evidence/a2
git status

# Gates
npm install                              # pulls new @pharmacare/batch-repo into the workspace
npx turbo run build --filter=@pharmacare/batch-repo...
npx vitest run --project=@pharmacare/batch-repo
npx vitest run --project=@pharmacare/bill-repo
npx vitest run --project=@pharmacare/gst-engine

# Commit
git -c user.name=aivora017 -c user.email=aivora017@gmail.com commit -m "feat(a2): FEFO batch allocator + append-only stock ledger

- migration 0007: partial index idx_batches_fefo, deterministic v_fefo_batches (batch_no tiebreak),
  stock_movements ledger, opening-balance backfill + AFTER INSERT trigger,
  upgraded trg_bill_lines_decrement_stock to write 'bill' movement row,
  append-only guard triggers (UPDATE/DELETE rejected)
- @pharmacare/batch-repo (new): allocateFefo, listFefoCandidates, recordMovement,
  commitAllocations, auditLedger, InsufficientStockError
- 20 unit tests + 50k-row perf probe (p95 0.46ms vs 5ms gate)

Closes A2 per ADR 0004/0005."
git push -u origin feat/a2-batch-stock
```

## Acceptance evidence to capture before merging

Put under `docs/evidence/a2/`:

- `perf.json` — already captured (auto-written by perf test)
- `tests.txt` — `npx vitest run --project=@pharmacare/batch-repo` full log
- `migration.txt` — `sqlite3 :memory: < <(cat 000*.sql)` smoke log showing 7 migrations apply clean

## Notes / known follow-ups

- **Rust-side mirror (A6 scope, not A2):** `apps/desktop/src-tauri/src/batches.rs` will port these FEFO reads + `recordMovement` writes into rusqlite so the billing UI path runs through one process. Keeping the Rust port out of A2 keeps the diff reviewable; the schema + triggers in 0007 are the contract both sides must honour.
- **Auto-opening trigger vs explicit call:** chose AFTER INSERT trigger on `batches` so fresh DBs satisfy the ledger invariant from `t=0` without any repo discipline. The trade-off is documented in ADR 0005 ("Alternatives considered").
- **`commitAllocations` exists but the common path is the `bill_lines` trigger.** Rationale: A6 will INSERT bill_lines in a single transaction; letting the trigger do stock decrement + movement write is atomic-by-construction and avoids a double-entry race if the caller forgets to call `commitAllocations`. `commitAllocations` is retained for tests and for any future path (e.g. bulk imports, return flows) that bypasses bill_lines.
- **Pre-existing HSN tech debt (NOT A2 scope):** `packages/grn-repo`, `packages/reports-repo`, `packages/seed-tool` ship with tests that use 8-digit HSN `'30049099'`. Migration 0006 (A1) only whitelists 4-digit `'3003','3004','3005','3006','9018'`, so those test suites fail. This was already red on `main` (CI was down, not caught). Track as a separate follow-up: either widen the whitelist to accept 4+4 composite HSN (India uses both) or update the seeds to use 4-digit codes. **A2 does not touch, move, or regress these.**
- **Perf test exceeds CI default timeout headroom.** It completes in ~1.1 s on sandbox but reserves a 60 s vitest timeout to survive slower HDD runners. Move to `--project` so contributors can skip with a single filter if needed.
- **`mv_opn_<batchId>` id scheme is not ULID.** Chosen so the backfill `INSERT … LEFT JOIN … WHERE m.id IS NULL` is idempotent across re-runs of 0007 on upgraded DBs. Same follow-up ADR that decides ULID for the repo will revisit this.

## File list

```
packages/shared-db/migrations/0007_a2_batch_stock.sql           (125 lines)
packages/batch-repo/package.json                                (new)
packages/batch-repo/tsconfig.json                               (new)
packages/batch-repo/src/index.ts                                (298 lines)
packages/batch-repo/src/index.test.ts                           (320 lines, 20 tests)
packages/batch-repo/src/perf.test.ts                            (193 lines, 1 test)
vitest.workspace.ts                                             (+1 entry: packages/batch-repo)
docs/adr/0005-a2-batch-stock-ledger.md                          (new)
docs/evidence/a2/perf.json                                      (auto-written by perf test)
docs/evidence/a2/HANDOFF.md                                     (this file)
```
