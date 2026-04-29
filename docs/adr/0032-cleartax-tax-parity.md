# ADR-0032: ClearTax tax-parity validation

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Tax computation is custom Rust in commands.rs lines 216-231, not validated against any GSP. Risk of mis-filed GSTR-1.

## Decision
Every saved bill triggers async parity check against ClearTax sandbox. Drift > ₹0.50 logs alert + flags bill for owner review. 100 fixture bills run in CI.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- replace our engine entirely with ClearTax SDK
- accept divergence
- Cygnet parity instead

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
