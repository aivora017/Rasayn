# @pharmacare/migration-import -- CHANGELOG

## [Unreleased]

### S28-A5 -- Marg CSV importer harden + synthetic Vaidyanath data (2026-05-08)

Sprint goal: make the importer survive every real Marg-export edge case
the Vaidyanath Pharmacy pilot will throw at us on 2026-05-13.

**Added -- synthetic fixtures (`tools/`):**

- `tools/gen_synthetic_vaidyanath.py` -- deterministic generator
  (seed `20260508`); idempotent + offline.
- `tools/synthetic-vaidyanath-master.csv` -- 566 rows (~500 SKUs +
  multi-batch dupes); UTF-8 BOM + CRLF; mixed date formats; INR/Rs./
  rupee-symbol prefixes; HSN whitespace; Devanagari ItemNames; Schedule
  H/H1/X mix; manufacturer-name variants for canonicalization tests.
- `tools/synthetic-vaidyanath-customers.csv` -- 200 customers, ~50% with
  GSTIN, addresses with embedded commas (quoted).
- `tools/synthetic-vaidyanath-suppliers.csv` -- 30 distributors with
  DLNo + GSTIN.
- `tools/README.md` -- regen instructions + edge-case index.

**Added -- hardened adapter surface (`src/harden.ts`):**

- `normalizeHsn`, `hsnGstCoherent`, `normalizeScheduleClass`,
  `parseMargDate` (4 formats + ISO), `isExpired`,
  `canonicalManufacturer`, `detectMfrDuplicates`,
  `adaptMargItemMasterCsvHardened`, `renderErrorReport`.
- `adaptMargItemMasterCsvHardened` is the single entry point for the
  real Marg-export shape; emits one product row per `ItemCode`, one
  batch row per `(ItemCode, BatchNo)`; expired batches keep
  `is_expired: 1` so the FEFO selector at sale time blocks them.

**Hardening checklist (this sprint):**

- [DONE] BOM strip + CRLF normalize
- [DONE] Date parser: 4 formats + ISO; clear error otherwise
- [DONE] Currency-prefix stripper (INR / Rs / rupee-symbol)
- [DONE] HSN normalizer (strip + pad + flag invalid)
- [DONE] ScheduleClass normalizer (uppercase; empty -> OTC)
- [DONE] Manufacturer canonicalization with near-dup merge suggestions
- [DONE] Multi-batch handling (one product, N batch rows)
- [DONE] Expired-batch flag (`is_expired: 1`); FEFO blocks at sale
- [DONE] HSN-vs-GST coherence warning
- [DONE] Per-row error report rendered as CSV via `renderErrorReport`
- [DEFERRED] Row-range grouping in error report. Reason: synthetic input
  produces 0 errors against the standard fixture; range grouping is a
  UX nicety, not load-bearing for the pilot. Tracked: post-launch QoL.

**Tests** -- `src/harden.test.ts`:

- 49 tests, all green. Covers all hardening primitives + the synthetic
  CSV integration (>=450 / <=520 product rows, batches > products,
  Devanagari present, all `mrpPaise` positive, multi-batch shape,
  duplicate-batch warning, expired flag, invalid-date row reporting,
  HSN whitespace/padding, BOM tolerance, error-report quoting).
- `src/index.test.ts` (27 tests) untouched and still green.
- `src/cli.test.ts` (4 tests) -- 3 green; 1 unrelated failure caused by
  pre-existing `better-sqlite3` Windows native binary in the Linux
  sandbox (`invalid ELF header`); not regression from this sprint.

**Dependencies:** none added. No new runtime or dev deps.

**Integration notes for lead:**

1. Importer surface is stable; downstream wiring should call
   `adaptMargItemMasterCsvHardened` and respect both the per-row
   `errors` (skip + report) and `source.warnings` (surface to UI).
2. The `is_expired: 1` field on batch rows is the FEFO contract -- the
   bill engine's existing FEFO-selector test must be re-run against
   imported batches to confirm expired batches are excluded from the
   pickable pool (`hard rule 9` per `PROJECT_INSTRUCTIONS.md` section 10).
3. Manufacturer near-duplicate warnings should be presented in the UI
   as suggested merges, not auto-merged -- the canonical key is
   informational, the raw spelling is what gets persisted.
