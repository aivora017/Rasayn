# ADR 0072 — Telemetry Sentry crash reporting + PII redaction (S27.E)

**Date:** 2026-05-08 · **Status:** ACCEPTED · **Decider:** Sourav Shaw, founder
**Authority rank:** Rank-3 (below Playbook v2.0 §1 + §8.1).

**Supersedes (partial):** ADR-0065 — Sentry portion only. OTel + Grafana
remain Draft in 0065. ADR-0065 is annotated "Sentry portion superseded by 0072".
**Relates to:** Playbook v2.0 §1 rule #6, §11, §12; DPDP Act 2023 §10 + §16;
ADR-0048 (cross-border columns); migration 0049_telemetry_opt_in.sql.

---

## Context

`telemetry.rs` shipped as a documented stub. ADR-0065 promised a full
Sentry + OTel + Grafana stack but was Draft and not actionable. S28
ship-readiness (FORWARD_PLAN_v4 §4) requires real crash reporting before
pilot Day-1 at Vaidyanath. Founder is on-call for first 30 days; without
Sentry he is blind to 11pm panics on the rig. `sentry 0.34` is the FIRST
outbound network dep on the desktop binary (Playbook §12 trigger).

## Decision

1. Add `sentry 0.34` as OPTIONAL feature-gated dep:
   `telemetry-sentry = ["dep:sentry"]`. Default builds do not compile it.
2. Init reads `PHARMACARE_SENTRY_DSN` from env. Absent => no-op (graceful).
3. `before_send` redactor walks every event with the regex set + key-name
   denylist below. Defence-in-depth on top of `send_default_pii=false`.
4. `cloud_egress_allowed(shop_opt_in)` reads `shops.telemetry_opt_in`
   (migration 0049). Default 0. Per-shop, never global.
5. UI: Settings -> Telemetry toggle (lawyer-final consent text, S31).
6. OTel + Grafana DEFERRED to S29+. This ADR is Sentry-only.

## Threat model — IN scope

- Rust `panic!()` + unwrap-on-None in production (sentry `panic` feature).
- Network errors from Cygnet GSP / ClearTax with redacted bodies.
- Performance regressions surfaced via `tracing::error!`.

## Threat model — OUT of scope

- Malicious actor inside the Tauri runtime (DEK in OS-keyring is gone
  long before Sentry leaks).
- Targeted PII exfil via a hand-rolled `tracing::info!("phone {}", p)`
  bypassing the redactor. Mitigation in S30: clippy lint + review.
- DSN leakage to a malicious shop owner (env-side; they can disable).

## PII redaction policy

`before_send` -> `redact_event` (in `telemetry.rs`) walks tags, extras,
and message in two passes.

### Pass 1 — regex string redactor (in order, longest/most-specific first)

1. **GSTIN** — `[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}`
2. **PAN** — `[A-Z]{5}[0-9]{4}[A-Z]`
3. **email** — `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`
4. **phone** — `\d{10}`

Match -> replace with literal `[REDACTED]`. Order matters: GSTIN digits
would otherwise hit the bare phone pattern; PAN's prefix overlaps GSTIN.

### Pass 2 — key-name denylist (case-insensitive substring match)

- `customer_phone`
- `customer_address`
- `prescription_text`
- `rx_image_path`

Value replaced wholesale regardless of regex match (catches `"n/a"` etc).

## Per-shop opt-in toggle

Default OFF. UI flow:

1. Settings -> Telemetry section.
2. Banner: "Crash reports help us fix bugs. We strip phone, GSTIN, PAN,
   email, address, prescription text before upload. Off any time."
3. Toggle (off by default).
4. On enable: write `telemetry_opt_in=1` + `telemetry_dsn_set_at=now()`
   in one tx. Refuse if `cross_border_opinion_at IS NULL` (DPDP §16).
5. On disable: set 0; next restart drops the Sentry guard.

## Cross-border DPDP §16

Sentry SaaS is hosted in EU/US. Migration 0048 already records
`cross_border_opinion_at` + `cross_border_jurisdiction`. UI MUST refuse
the toggle when these are NULL. `cloud_egress_allowed` is the second-to-
last defence; SDK init returning None on missing DSN is the last.

## GA gate

Telemetry stays internal-only (founder rig + clone VM) until BOTH:

- >=100 events captured in staging Sentry project.
- 0 PII leaks confirmed via spot-check on every event in that 100
  (manual review by founder; checklist: phone, PAN, GSTIN, email,
  address, Rx text, Rx image path, customer name).

Only then does the Settings toggle land in the Vaidyanath production
build. Tracked in `_research_brain/06_pilot/telemetry_ga_gate.md` (S28).

## Consequences

**Positive:** real crash visibility for founder; plumbing ready for
OTel/Grafana plug-in in S29+; default builds remain offline.

**Negative:** regex set is heuristic (9-digit phone or hyphenated GSTIN
slip through — mitigated by key denylist + GA spot-check); Sentry free
tier rate-limits at ~5k events/day (fine for 1 pilot shop); adding any
network dep widens the attack surface even feature-gated.

**Operational:** founder runs `cargo build --features telemetry-sentry`
for staging only. DSN goes in `PHARMACARE_SENTRY_DSN` env at install
time, never in repo.

## References

- Playbook v2.0 §1 rule #6, §11, §12
- ADR-0065 (Sentry portion superseded; OTel/Grafana still Draft)
- ADR-0048 (DPDP §16 columns); migration 0049_telemetry_opt_in.sql
- FORWARD_PLAN_v4 §4 S27 + S28; DPDP Act 2023 §10 + §16
