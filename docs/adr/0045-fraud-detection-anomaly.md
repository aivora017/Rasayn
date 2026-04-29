# ADR-0045: Fraud / staff-theft anomaly detection

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Audit trail exists but no proactive detection. Research lists this as top complaint.

## Decision
Isolation Forest on engineered features (discount rate, voids, after-hours, schedX velocity). Sarvam-30B narrative explainer for flagged windows.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- rule-based only
- supervised classifier
- skip

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
