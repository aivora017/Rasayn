# ADR-0031: Crypto at-rest (AES-GCM + OS-keyring DEK)

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Crypto package currently throws CryptoNotImplementedError. PII + Rx encryption is a DPDP Act 2023 requirement.

## Decision
Per-shop Data Encryption Key (DEK) wrapped by OS-keyring KEK (Windows DPAPI / macOS Keychain / Linux libsecret). AES-256-GCM for blobs, HMAC-SHA-256 for indexed columns.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- envelope encryption with AWS KMS
- client-side libsodium with passphrase
- SQLCipher full-DB only

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
