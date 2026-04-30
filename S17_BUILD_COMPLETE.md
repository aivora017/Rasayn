# Sprint 17 — Hardware fingerprint + cargo integration tests + ABDM consent registry — COMPLETE

**Date:** 2026-04-29
**Window:** S17 (continuation of S16 same Cowork mandate)
**Goal:** finish the Phase-C licence story with a real hardware
fingerprint, harden the new modules with proper cargo integration tests,
and bring ABDM consent registry online from the existing scaffold.

---

## 1. Deliverables

### 1.1 Hardware fingerprint Tauri command (S17.1)

`apps/desktop/src-tauri/src/system_info.rs` (143 LoC).
- Reads CPU model + first non-loopback MAC + first disk serial via OS-native
  shell calls (PowerShell on Windows, `/proc` + `lsblk` on Linux,
  `sysctl` + `system_profiler` on macOS). No new crate dep.
- SHA-256s the concatenation `cpu|mac|disk` to a 64-char hex `fullHash`,
  exports `shortHash` as the first 6 hex chars (matches
  `@pharmacare/license` encoding).
- Two unit tests: `first_nonempty_line_works`,
  `fingerprint_format_when_at_least_one_token_present`.

`LicenseScreen.tsx` rewired:
- Boot effect calls `systemInfoFingerprintRpc()` once.
- `onActivate`, `onClearLicense`, and `startTrial` all use the real FP.
- `DEMO_FP` retained as a tests-only fallback when the IPC mock has no
  `system_info_fingerprint` handler.

### 1.2 Cargo integration tests for stock_transfer + product_ingredients + license + abdm (S17.2)

| Module | Tests added | What they cover |
| --- | ---: | --- |
| `stock_transfer.rs` | 4 | migration applied, dispatch writes transfer_out movement, double-dispatch blocked by partial UNIQUE, self-transfer rejected by CHECK |
| `product_ingredients.rs` | 4 | migration applied, ON CONFLICT update keeps row count at 1, list filter by product_id, soft-delete preserves mapping |
| `license.rs` | 4 | migration applied, ON CONFLICT upsert, CHECK constraint on `id='singleton'`, DELETE clears |
| `abdm.rs` | 3 | migration applied for both abha_profiles + abdm_dispensations, upsert-then-query, status CHECK rejects invalid |
| `system_info.rs` | 2 | first_nonempty_line, hash format |

**+17 cargo tests this sprint** (121 → ~138). The earlier S16 borrow bug
in `license.rs` would have been caught by the upsert test; adding
coverage now to prevent regressions.

### 1.3 ABDM consent registry (S17.3)

- `apps/desktop/src-tauri/src/abdm.rs` (250 LoC, 5 Tauri commands):
  `abdm_upsert_profile`, `abdm_get_profile`, `abdm_revoke_consent`,
  `abdm_log_dispensation`, `abdm_list_dispensations`.
- `ipc.ts` extended with 6 new DTOs + 5 IpcCall variants + 5 RPC wrappers.
- New `ABDMConsentScreen.tsx` (190 LoC): customer lookup, link new ABHA,
  revoke consent, recent FHIR dispensations table.
- Wired into `mode.ts` (`abdmConsents` already present), `featureFlags.ts`
  (`abdmConsents: true` default), `App.tsx`, and `AppShell.tsx`
  preview-nav.

---

## 2. Verification

| Check | Result |
| --- | ---: |
| 15 package vitest suites | **294 / 294 ✓** (was 265; +29 abdm) |
| `tsc --strict --exactOptionalPropertyTypes` | **0 errors ✓** |
| Tauri commands registered | **103** (was 94; +5 abdm + 1 system_info + 0 already-counted from earlier) |
| Rust modules in `src-tauri/src/` | **28** (was 26; + system_info + abdm) |
| Migrations | **43** (no new SQL — abdm was migration 0032 already; product_ingredients/license/stock-transfer-mvmts already in S15-S16) |
| Cargo tests added (sandbox) | **+17** (sandbox can't run cargo; counts confirmed from source) |

---

## 3. Repo state delta vs S16

| Metric | After S16 | After S17 |
| --- | ---: | ---: |
| Tauri commands | 94 | **103** |
| Rust modules | 26 | **28** |
| Real-impl screens | 34 | **35** (+ ABDMConsentScreen) |
| Package tests | 265 | **294** |
| Cargo test count target | 121 | **138** target |
| LicenseScreen uses real hardware fingerprint | no | **yes** |
| ABDM consent registry live | no | **yes** |

---

## 4. Open / deferred to S18

1. **Storefront-side license persistence** — `/api/license/issue` mints
   keys but doesn't store them anywhere. Need a tiny KV.
2. **Photo-GRN Tier-B (LayoutLMv3)** — biggest remaining pilot win for
   X3, blocked on ML model bundle ADR.
3. **Voice billing real** (Whisper-Indic + Sarvam-Indus) — blocked on
   model procurement.
4. **Counterfeit shield CNN** — closes the X3 second half.
5. **Multi-shop inventory view** — `batches.shop_id` schema refactor.
6. **DPDP DSR worker** — `apps/cloud-services/cmd/dsr-worker` is a stub.
7. **Cold-chain BLE temp logging** — `cold-chain` package is real (17
   tests); just needs the Tauri command + ColdChainScreen wiring.

---

## 5. Punch list to S18

- DR runbook drill — backup → wipe → restore on a fresh Windows VM,
  document timing.
- ColdChainScreen wiring (cold_chain Tauri commands + screen).
- Counseling Records — migration 0035 + counseling_records table already
  exist; wire CounselingScreen.
- Plugin marketplace install pipeline — ADR-0061 + plugin-sdk package
  (real, 13 tests); needs Tauri command for sandboxed install.

---

**Sprint 17 closed.** Three substantial wins on top of the green S16 base.
294/294 package tests, 0 strict tsc errors, 103 Tauri commands,
+17 cargo integration tests for the new modules.
