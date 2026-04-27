# ADR 0026 — ABDM Integration (Optional Toggle)

> **STATUS: DRAFT** (2026-04-27)

**Status:** DRAFT
**Date:** 2026-04-27
**Relates to:** ADR 0011 (A7 Rx capture), Build playbook v2.0 §8.8 (compliance)

---

## Context

Ayushman Bharat Digital Mission (ABDM) is the Indian government's
national health stack — Health ID (ABHA), Health Facility Registry
(HFR), Health Information Exchange & Consent Manager (HIE-CM), and
Drug Registry. It's optional today, expected to be mandatory for
licensed pharmacies in 2-3 years.

Pilot pharmacies are split: ~30% are early-adopters who want to
quote ABHA on every Schedule H bill (patient discount, future-proof,
"my CA says I should"). ~70% don't want anything to do with it
(complexity, no personal benefit yet).

---

## Decision

ABDM is a per-shop opt-in toggle, OFF by default. Activation is a
2-step flow:

1. **Shop registration:** owner signs up at hfr.abdm.gov.in, gets
   shop-specific Facility ID. Enters in PharmaCare Settings →
   Compliance → ABDM. Toggles "ABDM enabled" ON.
2. **Per-bill capture:** when a customer chooses to share, cashier
   types the 14-digit ABHA number into BillingScreen. The bill payload
   carries `abha_id` + consent timestamp. On bill save, an async job
   POSTs the dispensation record to ABDM's HIE-CM (under FHIR R4
   profile).

If the toggle is OFF, no ABDM-related UI or RPC call surfaces.

### Schema

Migration **0024** (when this ADR is approved):

```sql
ALTER TABLE shops ADD COLUMN abdm_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN abdm_facility_id TEXT;
ALTER TABLE bills ADD COLUMN abha_id TEXT;            -- 14-char nullable
ALTER TABLE bills ADD COLUMN abha_consent_at TEXT;     -- ISO8601 nullable

CREATE TABLE abdm_dispensation_log (
  id              TEXT PRIMARY KEY,
  bill_id         TEXT NOT NULL REFERENCES bills(id),
  fhir_payload    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','sent','acked','failed')),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  acked_at        TEXT
);
```

### Failure handling
ABDM endpoints have notoriously variable uptime. The async job retries
3× with exponential backoff. If still pending after 24h, the row is
flagged in ComplianceDashboard for owner review. ABDM down ≠ bill
blocked — pharmacy keeps shipping.

### Privacy
ABHA = health identifier per DPDP Sensitive Personal Data classification.
Consent capture is mandatory per DPDP §7. Cashier sees a one-line
consent prompt; verbal-yes is acceptable but logged with timestamp +
cashier ID.

---

## Alternatives considered

1. **Mandatory ABDM from Day-1.** Rejected — kills pilot adoption.
2. **Cloud-only ABDM proxy.** Rejected — playbook §6 (LAN-first).
3. **Full HIE-CM / ABHA login flow on the desktop.** Rejected — too
   much UX surface for a feature 70% of shops won't use. We capture
   the ID, we don't authenticate.

---

## Consequences

### Positive
- 30% of Tier-1 ICP that wants ABDM gets it as a tick-box.
- Future-proof when mandate lands.
- Low UI surface area when toggle is off.

### Negative
- FHIR R4 profile authoring is a sprint (~2 sessions).
- ABDM API stability is poor; need 3-retry policy.

---

## Test strategy

1. Toggle-off path: zero ABDM RPCs fire on any flow.
2. Toggle-on, no ABHA entered: bill saves cleanly, no log row.
3. Toggle-on + ABHA entered: bill saves, log row inserted with status='pending'.
4. Async job: mock ABDM endpoint, assert retry-3 + backoff.
5. ComplianceDashboard: log rows surface as a P2 row when 24h-stale.

---

## Open questions

1. Which ABDM facility-type do pharmacies register as? Confirm with HFR docs.
2. FHIR R4 profile — start from official India profile or from-scratch?
3. ABHA verification: do we accept owner-typed ABHA without OTP, or require OTP via abdm.gov.in?

---

## Build phases

| Phase | Scope | Effort |
|---|---|---|
| Phase 1 (this ADR) | DRAFT | THIS COMMIT |
| Phase 2 | Migration 0024 + Settings UI toggle | ~1 session |
| Phase 3 | BillingScreen ABHA-entry field + consent UI | ~1 session |
| Phase 4 | Async dispensation-log worker + FHIR R4 builder | ~2 sessions |
| Phase 5 | ComplianceDashboard ABDM tab + retry surfacing | ~1 session |

Total: ~5 sessions. Defer until 3+ pilots ask for it.
