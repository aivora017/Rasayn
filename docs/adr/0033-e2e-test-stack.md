# ADR-0033: E2E test stack (Playwright on built MSI)

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
CI runs unit + integration only. No assurance the actual MSI works end-to-end.

## Decision
Playwright drives the built Tauri MSI on Windows GH-Actions runner. 5 critical flows covered: bill, GRN, partial refund, GSTR-1 export, reconcile.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- Tauri-driver
- WebDriverIO
- manual smoke only

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
