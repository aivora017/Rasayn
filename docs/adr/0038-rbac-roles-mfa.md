# ADR-0038: RBAC roles + MFA on sensitive actions

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Every user has god-mode today. OwnerOverrideModal hardcodes the role string.

## Decision
5 roles: owner/manager/pharmacist/technician/cashier. Permission matrix in @pharmacare/rbac. MFA (TOTP or WebAuthn) gate on bill.void / expiry.override / schedX.dispense / stock.adjust / khata.writeOff / rbac.edit.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- ABAC
- Casbin
- oso

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
