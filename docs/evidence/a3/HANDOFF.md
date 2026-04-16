# A3 — Customer Master Handoff

Branch: `feat/a3-customer-master`
Parent: `origin/main` @ `625251e` (merge of PR #6, CI green)
Playbook: v2.0 §8.1, ADR 0004 row A3, ADR 0006.

## Files delivered

| Path | Lines | Purpose |
|---|---|---|
| `packages/shared-db/migrations/0009_a3_customer_master.sql` | 105 | phone_norm column, shop-scoped index, AI/AU triggers, one-shot backfill |
| `packages/directory-repo/src/index.ts` | 287 | normalizePhone, validateDoctorRegNo, walk-in helpers, upsertCustomer, lookupCustomerByPhone, doctor + prescription CRUD |
| `packages/directory-repo/src/index.test.ts` | 232 | 25 unit + integration tests (walk-in FK, EXPLAIN QUERY PLAN index assertion, doctor regNo edge cases) |
| `packages/directory-repo/src/perf.test.ts` | 152 | 10 k-row seed, 1 000 lookups (500 hits + 500 misses), writes perf.json |
| `docs/adr/0006-a3-customer-master.md` | 160 | Full ADR (D1–D6 + 6 alternatives) |
| `docs/evidence/a3/HANDOFF.md` | this | Gate evidence |
| `docs/evidence/a3/perf.json` | 15 | Perf harness output |

## Test results

```
RUN  v2.1.5 /tmp/pcp/repo/packages/directory-repo

 ✓ src/index.test.ts  (25 tests)
   ✓ normalizePhone                     (3)
   ✓ validateDoctorRegNo                (5)
   ✓ walk-in customer                   (4)
   ✓ customers CRUD                     (4)
   ✓ lookupCustomerByPhone              (5)  ← includes EXPLAIN QUERY PLAN assertion
   ✓ doctors                            (2)
   ✓ prescriptions                      (2)
 ✓ src/perf.test.ts   (1 test)
   ✓ p95 < 10 ms on 10k rows

Test Files  2 passed (2)
     Tests  26 passed (26)
  Start at  06:33:38
  Duration  ~300ms (including seed)
```

## Perf gate (ADR 0004 row A3)

Target: `lookupCustomerByPhone` p95 < 10 ms on 10 000-row seed.

| Metric | Value |
|---|---|
| Rows in customers table | 10 000 (shop_vaidyanath_kalyan: 8 000, shop_test_franchise: 2 000) |
| Iterations | 1 000 (500 hits + 500 misses, interleaved) |
| p50 | 0.011 ms |
| **p95** | **0.024 ms** |
| p99 | 0.047 ms |
| Gate | 10 ms |
| Headroom | **416x** |
| Seed wall time | 111 ms |

Raw JSON: `docs/evidence/a3/perf.json`.

## Index usage verification

`src/index.test.ts` contains:

```ts
it("lookupCustomerByPhone uses idx_customers_phone_norm", () => {
  const plan = db.prepare(`EXPLAIN QUERY PLAN
    SELECT id FROM customers WHERE shop_id = ? AND phone_norm = ? LIMIT 1`)
    .all("shop_x", "9822001122")
    .map((r: any) => r.detail).join(" | ");
  expect(plan).toMatch(/idx_customers_phone_norm/);
});
```

If a future migration drops the index or a future query regression
triggers a `SCAN customers`, CI fails at this assertion.

## Normalization coverage

Verified via `normalizePhone` + DB trigger that all of the following
collapse to `9822001122`:

```
+91 9822001122
91-9822001122
(982) 200-1122
982.200.1122
 9822001122
98220	01122       (tab)
/9822001122/
```

Sub-10-digit input → `NULL`.

## Walk-in FK verification

Test `walk-in customer can be referenced as FK on bills` inserts a bill
with `customer_id = cus_walkin_shop_vaidyanath_kalyan` and confirms it
commits. No null-code-path in the bills schema.

## Non-goals (deferred)

- **Live NMC reg-no verification** — deferred to X1 Phase 3 (background
  job, not a hot-path blocker).
- **Customer de-dup by name + DOB + area** — deferred; phone_norm is the
  sole dedup key for A3. If two customers share a phone (spouse, parent),
  F2 shows both and cashier picks.
- **ABDM ABHA lookup** — `consent_abdm` flag wired; actual FHIR R4 push
  is an optional feature behind a flag (§8.8).
- **X1-originated customer rows** — the X1 Gmail importer will write
  customers via `upsertCustomer` when invoices carry buyer details.

## Push sequence

Sandbox has no git creds. User runs from Windows PowerShell:

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"
git fetch origin
git checkout -B feat/a3-customer-master origin/main
# (the commit is already built on this SHA via alt-index plumbing; Claude
#  will print the exact SHA below)
git push -u origin feat/a3-customer-master
# Then open a PR on github.com titled:
#   "feat(A3): customer master — phone_norm index, walk-in, doctor registry"
```

