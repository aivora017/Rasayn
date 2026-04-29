# ADR-0030: Idempotency tokens on Tauri commands

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Network retry and double-click currently can create duplicate bills/GRNs/refunds — financial risk.

## Decision
Each write command takes a UUIDv7 idempotency_token; duplicate inserts return cached prior result via dedup table with 24h TTL.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- request-fingerprint hashing
- db unique constraint per business key only
- client-side throttle

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
