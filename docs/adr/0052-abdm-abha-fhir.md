# ADR-0052: ABDM/ABHA + FHIR R4 dispensation

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
ABDM adoption is hockey-sticking. Health-ID-linked dispensation is required for many gov schemes.

## Decision
Verify ABHA via NHA gateway. Push MedicationDispense FHIR R4 to UHI gateway. Encrypted consent token in keyring.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- URI string only
- skip
- third-party gateway

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
