# ADR 0071 — Crypto-at-rest design (S26.E silent killer #5)

**Date:** 2026-05-07 · **Status:** ACCEPTED · **Decider:** Sourav Shaw, founder
**Authority rank:** Rank-3 (below Playbook v2.0 §1 hard rules and §8.1 locked tech).

**Extends:** Playbook v2.0 §1 hard rule #6 (PII/Rx never leaves shop LAN without explicit per-feature opt-in)
**Relates to:** ADR-0031 (crypto-at-rest stub, now superseded), DPDP Act 2023 §10
**Supersedes:** any prior ADR that named `@pharmacare/crypto` as deferred / stub.

---

## Context

`packages/crypto/src/index.ts` shipped in S15 as a stub that threw
`CryptoNotImplementedError` on every call. The Sales Agreement and
OWNER_MANUAL imply Rx data is encrypted at rest; **it was not**. This is
both a security ticket (laptop theft / lost backup recovery) and a
misrepresentation risk against the pilot owner.

Brutal review (2026-05-06) marked this as silent killer #5. Pilot owner
Vaidyanath Pharmacy is being told the app encrypts patient data at rest;
without this fix the claim is false.

## Decision

### Algorithm choices (locked)

- **AES-256-GCM** for symmetric encryption at rest. Authenticated, FIPS-approved, ubiquitous on
  Indian compliance audit checklists. Picked over ChaCha20-Poly1305 because the latter has
  no equivalent compliance pedigree in the pharma audit context.
- **HMAC-SHA256** for tamper-evidence chains (audit log integrity).
- **PBKDF2-SHA256, 100k iterations** to derive a KEK from the owner's master password.
  Picked over scrypt for FIPS-mode predictability and `node:crypto` stdlib coverage.

### Key hierarchy

```
Master password (owner-known, never stored)
  ├─ PBKDF2 + per-shop salt → KEK (32 bytes, in OS keyring slot kek:<shop_id>)
  │
  └─ KEK wraps DEK (per shop, per key_id) → kek_wrapped_dek table (BLOB)
      │
      └─ DEK encrypts/decrypts: Rx images, prescriptions blob, customer phone+address
```

- **DEK per shop, per key_id.** `key_id="primary"` is the active. Rotation flips status to
  `rotated`; backups stay decryptable. `revoked` rows are dead-on-arrival.
- **KEK lives in OS keyring** via the existing `keyring` crate (Windows DPAPI / macOS Keychain
  / Linux Secret Service). On first launch, the wizard derives KEK from the owner's master
  password + per-shop salt, stores it in keyring as base64.
- **DEK lives wrapped** in `kek_wrapped_dek` (migration 0047). Unwrapped DEK held in
  `CryptoStore` in-memory cache; never touches disk.

### Threat model

| Adversary | Defended |
|---|---|
| Laptop theft (cold-boot disk dump) | YES — wrapped_dek useless without KEK; KEK in keyring is OS-encrypted |
| Lost SQLite backup file | YES — wrapped_dek without KEK is opaque |
| Malicious cleaner with USB | YES — same as above; +KEK requires owner master password |
| Compromised running process | NO — DEK is in process memory; full RAM dump exposes it |
| Compromised owner laptop with logged-in session | NO — by design; physical-presence assumption |
| Quantum computer | NO — AES-256 falls to Grover but practically secure ≥10 years |

Out of scope: at-rest encryption of `bills` table (would force every read through decrypt;
perf cost violates §1 hard rule #4 sub-2s billing). Only PII-heavy fields are encrypted:
prescriptions blob, customer phone+address, Rx images.

### Backup recovery

Lost KEK = lost data. Acceptable per pilot. Mitigations:
- Owner has master password; KEK can be rederived from password + per-shop salt.
- Emergency recovery: owner enters master password into the master-password setup screen;
  KEK reseeds keyring; existing wrapped DEKs decrypt; data returns.
- Salt is stored **unencrypted** in `shops.crypto_salt` (BLOB, not yet added — follow-up).

### Rotation policy

- **Quarterly KEK rotation** (every 90 days, configurable). Old KEK derives wrapped DEKs that
  flip from `active` to `rotated` (still decryptable). New KEK wraps a fresh DEK that becomes
  `active`.
- **DEK rotation independent of KEK** — admin "Re-key" action drops the cache, generates new
  DEK, re-encrypts all in-place rows.

### Out of scope for v0.2 (this ADR)

- Schema migration to mark which columns are encrypted (`product_images.is_encrypted`, etc.)
- Migration utility to encrypt existing in-place plaintext rows
- HSM / TPM integration (KEK in TPM is a Phase-3 enhancement)
- Asymmetric crypto (only at-rest needs symmetric)

These ship as S26.E follow-ups; the crypto primitives in this ADR are the foundation.

## Consequences

- **Install size + binary cost:** `aes-gcm 0.10` Rust crate adds ~80 KB to the desktop binary.
  Acceptable (binary is ~80 MB).
- **Cold-start:** PBKDF2 100k iterations adds ~150 ms one-time per session. Within §10 GA-gate
  cold-start budget.
- **Bill-save p95:** zero — bills aren't encrypted at rest (see Out of scope above).
- **DPDP §10 compliance:** at-rest encryption is one of the six "reasonable security
  practices" the DPB explicitly calls out. We satisfy it.

## Alternatives considered

- **Throw-everywhere stub stays + Sales Agreement reworded.** Rejected — pilot owner trust is
  a moat. Easier to ship the crypto than to negotiate down the sales claim.
- **`@noble/ciphers` over `node:crypto`.** Rejected — Node 22 stdlib has every primitive we
  need; no third-party crypto code = smaller attack surface + smaller install.
- **OS-level full-disk encryption only (BitLocker / FileVault).** Rejected — covers laptop
  theft but not "USB-drive with backup mailed to founder" or "SQLite file copied for support."
  At-rest encryption inside the app is independent of OS-level encryption.
- **Per-row encryption of `bills`.** Rejected per §1 hard rule #4 (sub-2s billing). PII-heavy
  fields only.

## Open questions

- **Master password recovery** — what if owner forgets? Pilot answer: lost data, accepted risk
  with explicit clause in Sales Agreement. Phase-2 answer: owner-set 12-word recovery phrase
  derived from KEK at first launch, written down on paper.
- **Multi-device** — when shop adds a second till, how does the second device get the KEK?
  Phase-2: ABDM-style consent flow + QR pairing. Pilot: out of scope (single-till shops).
- **Audit log integrity** — HMAC-SHA256 chains are scoped here; the actual implementation in
  `audit_log` table happens in S27.

## Cross-references

- `packages/crypto/src/index.ts` — TypeScript primitives (`encryptAesGcm`, `decryptAesGcm`,
  `hmacSha256`, `generateDek`, `deriveKekFromPassword`, `serializeBlob`, `deserializeBlob`)
- `packages/crypto/src/index.test.ts` — 12 round-trip + tamper-detection tests
- `apps/desktop/src-tauri/src/crypto_store.rs` — Rust-side KEK keyring + DEK wrap/unwrap
- `apps/desktop/src-tauri/tests/crypto_store_test.rs` — 4 integration tests on the SQL surface
- `packages/shared-db/migrations/0047_crypto_keys.sql` — `kek_wrapped_dek` table

Last updated: 2026-05-07.
