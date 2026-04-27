# ADR 0027 — PMBJP Generic Substitution Library

> **STATUS: DRAFT** (2026-04-27)

**Status:** DRAFT
**Date:** 2026-04-27
**Relates to:** ADR 0011 (A7 Rx), playbook v2.0 §8 compliance + §9 ICP

---

## Context

Pradhan Mantri Bhartiya Janaushadhi Pariyojana (PMBJP / Jan Aushadhi)
is India's generic-medicine programme. As of 2026, PMBJP-empanelled
pharmacies are required to offer the generic equivalent for every
branded prescription, and patients can choose. Most ICP shops aren't
PMBJP-empanelled but their patients increasingly ask: "is there a
generic for this?"

Today PharmaCare Pro doesn't surface that question. Adding a curated
mapping (`brand_name → generic equivalents + price_diff`) is a high-
ROI feature: cheap to ship, lifts patient trust, primes the shop for
PMBJP empanelment if the owner chooses.

---

## Decision

A new pure-TS package `@pharmacare/pmbjp-substitution` ships:

1. A curated mapping `brand_name → [{ generic_name, manufacturer,
   strength, mrp_paise }]`. Initial list: top 200 prescribed
   molecules (Crocin, Dolo, Combiflam, Cipla branded, etc.) with
   1-3 generic alternatives each.
2. A pure function `findGenericAlternatives(brandLine: BillLine):
   readonly Alternative[]` that returns the alternatives, sorted by
   ascending MRP.
3. A BillingScreen surface — when the cashier picks a branded SKU and
   the alternatives list is non-empty, an inline chip appears:
   "Generic available — ₹X cheaper". Clicking swaps the line.

### Data sourcing

Mapping is built from PMBJP's official price list (downloaded
quarterly from janaushadhi.gov.in) + cross-referenced with CDSCO's
National List of Essential Medicines (NLEM). Updated as a versioned
JSON file under `packages/pmbjp-substitution/data/<period>.json`,
with a CI job that warns when 90 days stale.

### Compliance fit
- Schedule H/H1/X drugs CAN be substituted only with same-molecule,
  same-strength generics. Schedule G/X cannot be substituted at all
  (NDPS-class). The library encodes these constraints.
- The substitution is OFFERED, never automatic. Cashier always confirms.
- Audit log captures every substitution: who, when, original-SKU,
  chosen-SKU, ₹-diff. CGST §35 retention applies.

### Package layout

```
packages/pmbjp-substitution/
├── package.json
├── data/
│   └── 2026-Q2.json              # versioned data file
├── src/
│   ├── index.ts                  # findGenericAlternatives()
│   ├── types.ts
│   └── *.test.ts
```

---

## Alternatives considered

1. **Pull from PMBJP API live.** Rejected — no public API, and we'd
   inherit their uptime.
2. **Bundle in core.** Rejected — package boundary is cleaner; users
   who don't want PMBJP can omit the import.
3. **AI-generated alternatives.** Rejected — hallucination risk in a
   regulated domain.

---

## Consequences

### Positive
- Patient-facing differentiator vs Marg/BUSY.
- Quarterly data update is a 4-hour task per cycle.
- Sets up empanelment when shop owner chooses to apply.

### Negative
- Quarterly data refresh is a SOP item (out-of-repo).
- 200-molecule initial list is ~30% of the long-tail; expansion
  needed over time.

---

## Test strategy
- Round-trip: every brand entry has a non-empty alternative list.
- Schedule-H brands → only same-molecule generics returned.
- Schedule-G brands → empty array (cannot substitute).
- Empty MRP / negative price-diff → filtered out.
- Stale-data warning fires when data file is >90 days old.

---

## Build phases
| Phase | Scope | Effort |
|---|---|---|
| Phase 1 (this ADR) | DRAFT | THIS COMMIT |
| Phase 2 | Initial 200-molecule data file + library shell | ~2 sessions |
| Phase 3 | BillingScreen inline chip + line-swap UX | ~1 session |
| Phase 4 | Audit log capture + ComplianceDashboard view | ~1 session |
