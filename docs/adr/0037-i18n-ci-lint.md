# ADR-0037: i18n CI lint

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Hardcoded English in screens despite i18n infrastructure in design-system.

## Decision
ESLint rule blocks JSXText nodes containing >1 word in English in apps/desktop/src/components/. Whitelist for code/numeric/proper nouns.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- runtime detect
- manual review
- skip enforcement

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
