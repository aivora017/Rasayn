# ADR-0065: Telemetry stack (Sentry + OTel + Grafana)

**Status**: Draft (Sentry portion superseded by ADR-0072 on 2026-05-08; OTel + Grafana remain Draft)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Cannot operate 100 shops without observability. Cannot do predictive maintenance without telemetry.

## Decision
OTel SDK in desktop + cloud. Sentry for errors. Grafana Cloud for metrics + traces. Per-tenant tags.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- Datadog
- NewRelic
- logs only

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- Sentry-specific portion superseded by ADR-0072 on 2026-05-08 (S27.E real wireup with PII redaction + per-shop opt-in via migration 0049).
- OTel + Grafana portions remain Draft; deferred to S29+.
