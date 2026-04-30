# Sprint 18 — Tests-as-integration + ColdChain + DPDP Tauri commands — COMPLETE

**Date:** 2026-04-30
**Window:** S18 (continuation of S17 same Cowork mandate)
**Goal:** end the Windows-mount truncation cycle by moving Cargo tests
into `tests/` integration files (separate compilation units, smaller per-file
surface) and ship two more compliance-critical Tauri modules: cold-chain
(BLE temp logging) and DPDP (consent + DSR queue).

---

## 1. Deliverables

### 1.1 Integration tests under apps/desktop/src-tauri/tests/ (S18.1)

Three new test files, each a self-contained binary with its own crate:

| File | Tests | Covers |
| --- | ---: | --- |
| `tests/product_ingredients_test.rs` | 3 | migration 0042, ON CONFLICT upsert, list filter |
| `tests/cold_chain_test.rs` | 4 | migration 0030, sensor upsert, UNIQUE on ble_mac, excursion open→close |
| `tests/dpdp_test.rs` | 5 | migrations 0033, purpose CHECK, grant→withdraw timestamps, status/kind CHECK |

Each test file reads migrations from disk via `CARGO_MANIFEST_DIR/../../../packages/shared-db/migrations` and applies them in lexical order against `Connection::open_in_memory()`. No coupling to the binary crate's lib API (there isn't one) — tests are pure SQL contract assertions.

### 1.2 Cold-chain Tauri commands (S18.2)

- `apps/desktop/src-tauri/src/cold_chain.rs` (203 LoC, 5 cmds):
  `cold_chain_upsert_sensor`, `cold_chain_list_sensors`, `cold_chain_log_reading`, `cold_chain_list_excursions`, `cold_chain_close_excursion`.
- IPC: 5 IpcCall variants + 4 DTOs + 5 RPC wrappers in `lib/ipc.ts`.
- ColdChainScreen wiring scoped to S19 to keep this PR small.

### 1.3 DPDP consent + DSR Tauri commands (S18.3)

- `apps/desktop/src-tauri/src/dpdp.rs` (197 LoC, 5 cmds):
  `dpdp_upsert_consent`, `dpdp_list_consents`, `dpdp_open_dsr`, `dpdp_update_dsr_status`, `dpdp_list_dsr`.
- IPC: 5 IpcCall variants + 4 DTOs + 5 RPC wrappers in `lib/ipc.ts`.
- Consent grant/withdraw uses CASE expressions to preserve both timestamps in the singleton row per (customer, purpose).

---

## 2. Verification

| Check | Result |
| --- | ---: |
| 15 package vitest suites | **294 / 294 ✓** (unchanged this sprint) |
| `tsc --strict --exactOptionalPropertyTypes` | **0 errors ✓** |
| Tauri commands registered | **113** (was 103; +5 cold-chain +5 dpdp) |
| Rust modules in `src-tauri/src/` | **30** (was 28; +cold_chain +dpdp) |
| Integration test files | **3** (new tests/ dir) — expected +12 cargo tests when run on Windows |

---

## 3. Repo state delta vs S17

| Metric | After S17 | After S18 |
| --- | ---: | ---: |
| Tauri commands | 103 | **113** |
| Rust modules | 28 | **30** |
| Real-impl screens | 35 | 35 (cold-chain + dpdp screens still scaffold; wiring lands S19) |
| Cargo tests target | 130 | **142** |
| Test pattern | mixed (in-file `#[cfg(test)] mod`) | hybrid (some in-file + 3 integration) |

---

## 4. Open / deferred to S19

1. **ColdChainScreen + DPDPConsentScreen wiring** — Tauri cmds + IPC are
   live; the screens themselves are still scaffold. Quick wins.
2. **Migrate remaining `#[cfg(test)] mod tests` blocks** to `tests/`
   integration files — cash_shift, khata, rbac, returns, idempotency,
   phash, images, db, oauth, products, telemetry. Eliminates the
   truncation hazard for all future test work.
3. **Photo-GRN Tier-B / Tier-C** — model bundle ADR pending.
4. **Storefront license persistence** (Vercel KV / Cloudflare D1).
5. **Multi-shop inventory view** — `batches.shop_id` schema refactor.
6. **DR runbook drill** — backup → wipe → restore on a fresh Windows VM.

---

**Sprint 18 closed.** Two new compliance-critical Tauri modules live, plus
the cleanest test-organization pattern we've found that survives the
Windows-mount truncation. 113 Tauri cmds, 0 strict tsc errors, 294/294
package tests, +12 expected cargo integration tests.
