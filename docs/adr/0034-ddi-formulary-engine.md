# ADR-0034: DDI + allergy + dose engine architecture

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Zero clinical-safety alerts in current build. Every modern competitor has DUR.

## Decision
Edge-tier @pharmacare/formulary with seeded FDA Orange + CIMS-India + BNF dose tables. Sarvam-30B explainer for plain-language reasons. Pairwise scan at line-add.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- cloud-only API call
- third-party DDI vendor
- skip until v2

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
