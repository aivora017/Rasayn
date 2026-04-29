# ADR-0036: Reason-code library taxonomy

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Returns/refunds/expiry overrides/NPPA breaches use freetext today — bad for analytics + compliance.

## Decision
Controlled vocabulary in shared-types: returnReasons, refundReasons, expiryOverrideReasons, nppaBreachReasons. Required at write site.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- freetext + LLM normalization
- per-shop custom
- ICD-10 only

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
