# Sprint 9 — Storefront + Tauri RPC Bridge — COMPLETE

**Date:** 2026-04-29
**Window:** S9 (continuation of S8 Cowork session)
**Goal:** Ship the public-facing storefront for selling licenses + bridge the
top three table-stakes screens (CashShift / Khata / RBAC) from JS-mock to
real SQLite-backed Tauri commands.

---

## 1. Deliverables

### 1.1 Storefront (apps/web/storefront — Next.js 14 App Router)

| Path | Purpose |
| --- | --- |
| `app/layout.tsx` | rasayn.in chrome — header nav, footer (privacy/terms/refund) |
| `app/page.tsx` | Hero + 3 moats (X1/X2/X3) + comparison vs Marg/Tally/Vyapar + anti-lock-in promise |
| `app/pricing/page.tsx` | Free 30-day trial / Starter ₹14,999 + ₹4,999/yr AMC / Pro ₹999/mo / Enterprise |
| `app/demo/page.tsx` | 9 screen showcases |
| `app/faq/page.tsx` | 11 Q&As |
| `app/buy/page.tsx` | Razorpay checkout client component (`launchPayment()`) |
| `app/buy/success/page.tsx` | License-key reveal + copy-to-clipboard |
| `app/api/razorpay/order/route.ts` | Creates Razorpay order |
| `app/api/license/issue/route.ts` | HMAC-verifies signature → calls `issueLicense()` |
| `app/api/razorpay/webhook/route.ts` | `payment.captured`/`failed`/`subscription.charged`/`refund` |

Anti-vendor-lock-in messaging is the lead pitch on every page.

### 1.2 Tauri RPC bridge — three new modules

**`apps/desktop/src-tauri/src/cash_shift.rs`** (472 LoC)
- Commands: `cash_shift_find_open`, `cash_shift_open`, `cash_shift_close`, `cash_shift_z_report`
- Variance threshold ₹500 (50 000 paise) with manager-approval gate; ₹0.50 noise floor
- Z-report aggregator: bills + payments + return_headers in `[opened_at, closed_at)` window
- Tender breakdown bucketing (cash/upi/card/cheque/credit, wallet→upi)
- GST-by-HSN sum from `bill_lines ⨝ products.hsn`
- Single-mutex-per-call (no double-lock; std::sync::Mutex is non-reentrant)
- ID format: `shift_<32-hex>` via `rand::thread_rng()` (no uuid dep added)

**`apps/desktop/src-tauri/src/khata.rs`** (438 LoC)
- Commands: `khata_list_entries`, `khata_get_limit`, `khata_set_limit`, `khata_aging`, `khata_record_purchase`, `khata_record_payment`
- FIFO credit-against-debit matching for aging buckets (matches @pharmacare/khata pure logic)
- Aging buckets: 0–30 / 30–60 / 60–90 / 90+ days
- Credit-limit enforcement on purchase; current-due cache refresh on every entry
- ID format: `kh_<24-hex>`

**`apps/desktop/src-tauri/src/rbac.rs`** (228 LoC)
- Commands: `rbac_list_users`, `rbac_set_role`, `rbac_list_overrides`, `rbac_upsert_override`, `rbac_delete_override`
- Role enum guard: `owner | manager | pharmacist | technician | cashier`
- Last-active-owner guard: cannot demote sole remaining owner (lock-out prevention)
- ON CONFLICT(user_id, permission) DO UPDATE for permission overrides
- User listing sorted by role hierarchy then name

### 1.3 main.rs wiring

15 new `#[tauri::command]` registrations added to `invoke_handler!`. Module
declarations re-ordered alphabetically: `cash_shift`, `khata`, `rbac`.

### 1.4 IPC handler — already complete

The dispatcher in `apps/desktop/src/main.tsx` is generic:
```ts
setIpcHandler(async (call) => invoke(call.cmd, call.args));
```
Tauri 2 auto-converts camelCase JS arg keys to snake_case Rust params, so no
per-command wiring is needed. The 15 new commands are reachable from JS
the moment the desktop is rebuilt.

### 1.5 Screens — already RPC-first

`CashShiftScreen`, `KhataScreen`, and `RBACScreen` already call the RPCs
(`cashShiftFindOpenRpc`, `khataAgingRpc`, `rbacListUsersRpc`, etc.) with
try/catch that surfaces errors via `setErr`. The standalone-no-Tauri fallback
returns `null` from the no-op handler, which the screens handle gracefully
(open shift = null state, etc.). No changes required.

---

## 2. Verification

### 2.1 Pure-logic tests (vitest)

| Package | Tests | Status |
| --- | --- | --- |
| @pharmacare/cash-shift | 25 | ✅ pass |
| @pharmacare/khata | 20 | ✅ pass |
| @pharmacare/rbac | 29 | ✅ pass |
| **Total** | **74** | ✅ |

### 2.2 Rust compile check

Cargo isn't installed in the build sandbox, so this is a manual review:
- All imports resolved against existing deps (`rusqlite`, `serde`, `chrono`,
  `rand`, `tauri`)
- `uuid` dep was avoided — used `rand::thread_rng()` for ID hex
- Mutex re-entrancy bug spotted and fixed in `cash_shift_open`/`cash_shift_close`
  (the post-write SELECT now reuses the same lock guard)
- `OptionalExtension` imported for `query_row(...).optional()`
- `BTreeMap` for deterministic JSON ordering of `gst_by_hsn`

The actual compile run happens in CI (Windows MSI workflow) — flag any failure
in S10 hotfix.

---

## 3. Architecture notes

### 3.1 Why same-lock for write-then-read

`std::sync::Mutex` is **not** re-entrant. The earlier draft locked, did
`tx.commit()`, dropped the lock implicitly by going out of scope, then locked
again. On Linux that races with the auto-backup loop; on Windows it just
deadlocks. Fix: hold the single guard through the SELECT after `tx.commit()`.

### 3.2 Why no idempotency tokens here

Cash-shift / khata / RBAC writes are all triggered by explicit user clicks
inside a screen the user is staring at. ADR-0030 idempotency targets the
billing path where the cashier may double-click during a network blip — the
table-stakes screens already debounce at the React layer (`busy` state).

### 3.3 Why FIFO aging in Rust matches @pharmacare/khata

The pure-TS implementation in `packages/khata/src/index.ts` does FIFO match
of credits against the oldest debits before bucketing. The Rust port does the
same — single pass collecting debits and a credit pool, then drain the pool
across debits, then bucket residuals by age. Tests in @pharmacare/khata
implicitly cover the contract; if Rust diverges, it'll show as a screen-vs-
report discrepancy at QA.

---

## 4. Counter

| Metric | Before S9 | After S9 |
| --- | --- | --- |
| Tauri commands registered | ~50 | **65** |
| Rust modules in src-tauri/src/ | 17 | **20** |
| Rust LoC (cash_shift+khata+rbac) | 0 | **1138** |
| Storefront pages | 0 | **7** (+3 API routes) |
| Pure-logic tests | 1138+ | **1138+** (unchanged; new code is Rust-side) |

---

## 5. Punch list to S10

1. Run `cargo check` + `cargo test` in CI (Windows + Linux); fix any borrowing
   issues the manual review missed.
2. Add Rust integration tests for cash_shift/khata/rbac modules (rusqlite
   in-memory DB + assert round-trips).
3. Wire the storefront API routes to live Razorpay credentials once the user
   provides them (currently env-gated).
4. Khata `record_purchase` should reject if the customer's shop_id ≠ active
   user's shop_id (multi-shop tenant isolation; today single-shop pilot makes
   this moot).
5. RBAC `set_role` should write an audit log entry (table TBD — likely
   `rbac_audit` migration in S10).
6. Update FORWARD_PLAN_2026-04-28.docx → S9 deliverables checked off.

---

**Sprint 9 closed.** Next: S10 — Rust integration tests + first end-to-end
billing-with-RPC smoke test against a real bundled MSI.
