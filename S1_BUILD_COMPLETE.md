# Sprint 1 Build — Real Implementations Shipped (2026-04-28)

## TL;DR

Sprint 1 closed. **86 new tests, all green.** Pharmacy-OS table-stakes foundation laid: every user has a role, every action checks a permission, the cash drawer can open/close with variance accounting, and customer credit ledgers age into proper buckets.

Critical correction caught during this session: most of the original Sprint-1 security HIGHs (S01–S05, OAuth refresh, TenderReversal tests, partial-return qty cap) were **already shipped in earlier April work** — the audit I ran this morning was based on a stale snapshot. So the real Sprint 1 work for this session was idempotency (C03) + table-stakes packages.

## What landed

### 1. Idempotency tokens — ADR-0030 (closes coverage gap C03)

| File | Status | What it does |
|---|---|---|
| `packages/shared-db/migrations/0038_idempotency_tokens.sql` | NEW | dedup table with 24h TTL + GC index |
| `packages/idempotency/` | NEW package | UUIDv7 + SHA-256 canonical request hash + IdempotencyConflictError |
| `apps/desktop/src-tauri/src/idempotency.rs` | NEW Rust module | `check()` / `record()` / `gc()` helpers + 5 unit tests |
| `apps/desktop/src-tauri/src/main.rs` | EDIT | `mod idempotency;` registered |
| `apps/desktop/src-tauri/src/commands.rs` | EDIT | `save_bill` checks token at top, records inside the same tx before commit |

**Tests:** 12 in `@pharmacare/idempotency` (UUIDv7 well-formedness + monotonicity, canonical hash key-order invariance, conflict error contract, TTL math).

**Deferred to next session (Task #38):** wiring `save_grn` and `save_partial_return` — pattern is established in `save_bill`, mechanical replication.

### 2. RBAC — ADR-0038 (replaces this morning's stub)

| File | Status |
|---|---|
| `packages/rbac/src/index.ts` | REAL impl — 5 roles, 32 permissions, `can()`, `canWithOverrides()`, `requiresMfa()`, `assertCan()`, `migrateLegacyRole()`, `listPermissions()`, `rolePermsDiff()` |
| `packages/rbac/src/index.test.ts` | 29 tests |

The permission matrix encodes the policy decisions you'll make again and again:
- Schedule X dispensing requires a licensed pharmacist (manager doesn't qualify).
- Khata write-off needs owner sign-off (manager can record payment but not write off bad debt).
- Variance approval at shift close requires owner.
- RBAC editing requires owner — no one elevates themselves.
- 12 specific permissions trigger MFA gate (TOTP or WebAuthn).

### 3. Cash shift — ADR-0039 (replaces this morning's stub)

| File | Status |
|---|---|
| `packages/cash-shift/src/index.ts` | REAL impl — denomination math, expected-vs-actual variance, Z-report builder, state-machine assertions, orchestration helpers (openShift / closeShift) with injected repo |
| `packages/cash-shift/src/index.test.ts` | 25 tests |
| `packages/shared-db/migrations/0023_cash_shifts.sql` | scaffold from earlier today |

Math is exact:
- Variance threshold = ₹500 (50000 paise) — shifts above must be approved by manager+
- Variance noise floor = 50 paise — below this it's "exact" rounding
- 10 denominations covered (₹2000/500/200/100/50/20/10 notes + ₹5/2/1 coins)
- Negative or fractional counts rejected (bills are physical objects)

### 4. Khata (credit ledger) — ADR-0040 (replaces this morning's stub)

| File | Status |
|---|---|
| `packages/khata/src/index.ts` | REAL impl — append-only entries, FIFO-match credits against oldest debits, aging buckets (0-30/30-60/60-90/90+), credit-limit enforcement, heuristic risk score, orchestration helpers (recordCreditPurchase / recordPayment / ageingForCustomer) |
| `packages/khata/src/index.test.ts` | 20 tests |
| `packages/shared-db/migrations/0024_khata_ledger.sql` | scaffold from earlier today |

Edge cases covered:
- Payment FIFO-matches the OLDEST debit first (clears 90+ bucket before current).
- Partial payment leaves residual in oldest unpaid bucket.
- Credit-limit check prevents over-extending.
- Payment cannot drive `currentDue` below zero.
- Heuristic risk score weighs both utilisation and 90+-share equally.

## Total counts after Sprint 1

| | Before | After |
|---|---|---|
| Source files | 734 | 741 (+7) |
| Test files (passing) | many | + 4 new test files |
| Tests passing | many | + 86 new |
| Migrations | 37 | 38 |
| Rust modules | 21 | 22 (idempotency.rs) |
| Real packages (not stub) | 21 | 25 (idempotency, rbac, cash-shift, khata graduated) |

## What's NOT done (deferred to Sprint 2+)

| Item | Sprint | Reason |
|---|---|---|
| Wire idempotency into `save_grn` + `save_partial_return` | S2 | Pattern proven in save_bill, mechanical replication; deferred for end-of-session safety |
| `CashShiftScreen.tsx` real UI | S2 | Backend math + tests done; UI is layout-on-API |
| `KhataScreen.tsx` real UI | S2 | Backend math + tests done; UI is layout-on-API |
| `RBACScreen.tsx` real UI | S2 | Backend perms done; UI is forms |
| MFA enrollment flow (TOTP / WebAuthn) | S3 | RBAC `requiresMfa()` flags exist but enrollment surface not built |
| Schedule H register UI | S4 | per ADR-0038 |
| Tally Prime XML export | S2 | per ADR-0041 |

## How to verify this session's work locally

```bash
cd pharmacare-pro

# Per-package tests (each runs ~300ms)
npm install   # picks up the new @pharmacare/idempotency workspace
npm run test --workspace @pharmacare/idempotency   # 12 ✓
npm run test --workspace @pharmacare/rbac          # 29 ✓
npm run test --workspace @pharmacare/cash-shift    # 25 ✓
npm run test --workspace @pharmacare/khata         # 20 ✓

# Full migration chain (37 → 38)
python3 -c "import sqlite3,glob; c=sqlite3.connect(':memory:'); c.execute('PRAGMA foreign_keys=OFF'); [c.executescript(open(f).read()) for f in sorted(glob.glob('packages/shared-db/migrations/*.sql'))]; print('OK')"
```

## What's the highest-leverage thing to do tomorrow morning

Wire `CashShiftScreen.tsx` to the cash-shift package. The math + state-machine + variance flow is already done and tested; the screen is composition + a denomination-grid form. Half a day of work to give the pharmacy owner a working "open day / close day" experience — without which they cannot run a single day on Rasayn.

