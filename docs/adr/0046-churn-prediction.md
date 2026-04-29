# ADR-0046: Customer churn prediction

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Retention drives unit economics — research says 60-day churn signal is missed by all SME tools.

## Decision
XGBoost on refill cadence features. Outputs ChurnScore[0..1] + recommended template. Drives WhatsApp outreach + dead-stock matching.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- heuristic last-purchase-days
- RFM only
- cloud SaaS vendor

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
