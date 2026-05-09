# ADR-0075 — Onboarding wizard validations are HARD GATES

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-08 |
| **Sprint** | S28 wave 2A B3 |
| **Supersedes** | none |
| **Superseded by** | none |
| **Related** | ADR-0029 (NorthStar §17 Design-Done checklist), ADR-0071 (crypto-at-rest), v2.0 §8 (compliance) |

## Context

The OnboardingWizard is the FIRST screen a pharmacy owner sees on a fresh
PharmaCare Pro install. Whatever they type here becomes the legal identity
of the shop in our SQLite spine: it's printed on every bill, embedded in
GSTR-1 / GSTR-3B / e-invoice payloads, and shown to inspectors.

Drugs & Cosmetics Act 1940 + Rules 1945 require:
- A valid Form 20 / Form 21 retail-sale licence (state-issued, format
  varies but always state-prefixed).
- A Schedule-H sales licence number traceable to the registered
  pharmacist; selling Schedule-H without one is a §22 violation.
- Retail-licence display visible in UI (re-affirmed in PROJECT_INSTRUCTIONS
  §8 — "retail-license link visible in UI").

DPDP Act 2023 §10 (Data Fiduciary obligations) requires:
- A Data Protection Officer (DPO) — name, email, phone — published.
- A grievance officer — name, email, phone — published. Both must be
  reachable; phone is not optional in §10's "easily accessible" reading.

DPDP §8 (collection-purpose minimisation) mandates a documented record of
the basis on which we hold a customer's PII. The retail-licence PDF
attestation is not legally required, but it reduces the friction on the
auditor's first request — hence we surface it as a yellow nudge rather
than a hard block.

The pre-S28 wizard validated only the entity-type-shaped baseline
(@pharmacare/entity-types#validateRegistration). It accepted invalid
GSTINs, accepted retail-licence strings of any format, did not collect
phone numbers in step 3, and did not guard against the user re-running
onboarding on a populated database.

## Decision

Every onboarding-wizard input becomes a HARD GATE on the "Save Shop"
button:

1. **GSTIN** — must pass `@pharmacare/gst-engine#validateGstin` (15-char,
   state-code in CBIC list, embedded PAN regex, position 14 = "Z",
   Mod-36 checksum). Inline error names the offending sub-field (length /
   stateCode / pan / checkLetter / checksum).

2. **Retail-licence number** — state-prefixed alphanumeric per
   `^[A-Z]{2}-(?:(?:DRG|FORM\s?20|FORM\s?21|DL)-)?[A-Z0-9]{4,15}$`.
   Documented in `apps/desktop/src-tauri/src/onboarding.rs` as the
   `RETAIL_LICENSE_RE` constant; source is the Maharashtra FDA portal
   layout cross-checked against Karnataka and Tamil Nadu samples.

3. **Retail-licence PDF** — OPTIONAL but with a yellow nudge if skipped:
   "DPDP §8 + D&C: retail-licence attestation strongly recommended."
   Tauri-side `attach_retail_license_pdf` enforces .pdf extension and a
   10 MiB cap.

4. **Schedule-H licence number** — REQUIRED. Same format as retail.
   Selling Schedule-H without this is a D&C §22 offence.

5. **DPO email** — RFC-5322 lite (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`).

6. **DPO phone** — 10-digit Indian mobile (+91 / 0 / bare 10-digit
   accepted; whitespace, hyphens, parens stripped).

7. **Grievance officer** — name, email, phone with the same rules as DPO.

8. **First-shop seed** — wizard probes `shop_get` for the active shop
   id; if a shop already exists, render the redirect panel ("you already
   have a shop — go to Settings to add another") instead of the wizard.

The Tauri commands `validate_retail_license_format` and
`attach_retail_license_pdf` (apps/desktop/src-tauri/src/onboarding.rs)
live BEHIND the wizard so the same rules apply when imports / Marg
migrations attempt to seed shop rows headlessly.

## Consequences

**Positive:**
- An owner literally cannot create a shop record that fails the GSTIN
  Mod-36 checksum — a class of bugs that previously surfaced only at
  GSTR-1 filing time, when it's far too late.
- Audit conversation is materially shorter: every shop row in production
  is provably valid against the same rules an inspector would check.
- The "first install" flow has a hard stop against duplicate shop creation
  — multi-shop add now goes through Settings, with a clear redirect.

**Negative:**
- Onboarding takes ~20 seconds longer because users must enter both a
  retail-licence AND a Schedule-H licence; some shops use the same
  number for both, but we kept them as separate columns to avoid
  conflating two legal regimes.
- The PDF nudge is non-blocking, so an owner can still skip it. We
  accepted this trade-off because the alternative (block on PDF) would
  break the runbook for shops that haven't digitised their licence yet.
- The DPO phone validator accepts +91 / 0 / bare-10-digit forms; mismatched
  customer-facing display formatting is left to the printed-bill layer.

## Alternatives considered

1. **Server-side only validation** (rejected) — The Tauri side already
   enforces email format in `dpo_compliance.rs#looks_like_email`, but
   waiting until form submit to flag a bad GSTIN punishes the user with a
   round-trip. Inline validation is necessary for the first-install
   experience.

2. **Pull GSTIN validity from a cloud API** (rejected for v0.1) — The
   GST council's GSTIN search API exists but requires sign-up and would
   add a network dependency to a flow that runs on day 1, possibly behind
   a flaky cellular hotspot. The Mod-36 checksum is an offline
   self-validating test that catches all transcription errors.

3. **Allow free-form retail-licence** (rejected) — Owner-typed numbers in
   the past produced "DRG12345", "MH 12345", "MH/DRG/12345", "drg12345"
   variants in the import-validator's findings (S25.4 Marg sample). A
   format check with a yellow nudge for borderline cases gives auditors
   a single canonical form to query against.

4. **Make PDF attestation hard-required** (rejected) — Many shops haven't
   scanned their licence yet on Day 1. Blocking on PDF would push install
   into a multi-day cycle, and we already pass the §8 documentation bar
   with the attested licence number alone.

## Implementation pointers

- `packages/gst-engine/src/gstin.ts` — validator + `GST_STATE_CODES` map.
- `packages/gst-engine/src/__tests__/gstin.test.ts` — 10 cases.
- `apps/desktop/src-tauri/src/onboarding.rs` — Tauri commands + 7 unit tests.
- `apps/desktop/src-tauri/src/main.rs` — `mod onboarding;` + 2 handler entries.
- `apps/desktop/src/components/OnboardingWizard.tsx` — wizard + helpers
  `isDpoComplete` / `isValidIndianMobile` / `isValidRetailLicense` /
  `validateOnboardingForm`.
- `apps/desktop/src/components/OnboardingWizard.test.tsx` — 26 cases.
- `packages/shared-db/migrations/0052_shops_licenses.sql` — adds
  `retail_license_pdf_path`, `schedule_h_license_no`, and
  `grievance_officer_phone` columns.
