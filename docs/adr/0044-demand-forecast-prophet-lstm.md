# ADR-0044: Demand forecasting (Prophet + LSTM hybrid)

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Dead stock costs ₹1-5L/yr per pharmacy. No forecasting today.

## Decision
Prophet for long trend, LSTM for short volatile. Per-SKU per-shop. Nightly retraining. Outputs reorder recommendations + auto-PO drafts.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- Prophet only
- Holt-Winters
- cloud SaaS forecast vendor

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
