# ADR 0015 — A10: GSTR-1 Monthly Export (JSON + CSV)

## Status
Proposed · 2026-04-17 · Parallel track off A6/A8/A9

## Context
Hard Rule 5 of the Playbook: "Compliance automatic, never manual." GSTR-1 is the outward-supplies return Indian pharmacies file monthly (turnover >₹5 Cr) or quarterly via QRMP (≤₹5 Cr, due 13th of quarter+1 month). Every single Tier-1 ICP pilot shop files GSTR-1 today — most via Tally or a CA's offline tool. Our pilot promise (§8.9 Project Instructions) is "GSTR-1 filed on our export." This ADR locks the data contract and pipeline from our `bills` + `bill_lines` tables to a GSTN-compliant JSON payload plus Tally-parity CSVs so the shop owner (or their CA) can upload directly to gst.gov.in or continue their existing CA hand-off.

Key regulatory facts verified live (2026-04-17):
- **B2CL threshold is ₹1,00,000** (raised from ₹2.5L in August 2024) — inter-state invoices to unregistered buyers above this go in B2CL; below it aggregate into B2CS.
- **HSN reporting was split in 2025** — separate "HSN for B2B" and "HSN for B2C" buckets are now mandatory.
- **Filing cadence**: monthly (11th of next month) for turnover >₹5 Cr; QRMP quarterly (13th of quarter+1) for ≤₹5 Cr. Pilot cohort is ≤₹5 Cr — QRMP by default. IFF (M1/M2 B2B pre-upload) is optional.
- **Offline-tool section catalogue**: `b2b, b2ba, b2cl, b2cla, b2cs, b2csa, cdnr, cdra, cdnur, cdnura, exp, expa, at, ata, atadj, atadja, exemp, hsn, doc` — 19 in total. The `...a` suffix sections are amendments.

The present repo state:
- `bills` has `gst_treatment ∈ {intra_state, inter_state, exempt, nil_rated}`, `subtotal/total_cgst/total_sgst/total_igst/total_cess` in paise, `billed_at` timestamp, `is_voided` flag, `shop_id/customer_id`, unique `(shop_id, bill_no)`.
- `bill_lines` has `hsn` via JOIN on `products`, `gst_rate ∈ {0,5,12,18,28}`, and paise-level tax components per line.
- `customers` carries nullable `gstin` (B2B signal — already used by A9 for A5 layout auto-select).
- `shops` has `gstin` (15 chars) and `state_code` (2 chars).

No existing GSTR-1 plumbing, no returns table, no filing-status column, no doc-series. All green-field.

## Decision

### Scope (v1 ships)
Six sections generated for v1:
1. **b2b** — customer has GSTIN.
2. **b2cl** — no customer GSTIN, `gst_treatment = 'inter_state'`, `grand_total_paise > 1_00_00_000` (₹1 L in paise).
3. **b2cs** — residual: no customer GSTIN AND (intra-state OR inter-state ≤ ₹1 L). Aggregated by (place-of-supply, rate, e-commerce-flag). E-commerce flag always `false` in v1 (no marketplace integration).
4. **hsn** — two sub-blocks `hsn_b2b` + `hsn_b2c` (2025 split). Aggregated by `(hsn, gst_rate, uqc)`. UQC fixed to `NOS` for pharmacy strips/bottles in v1 (future ADR when X2 SKU master carries explicit UQC).
5. **exemp** — bills with any line at `gst_rate=0` OR `gst_treatment ∈ {exempt, nil_rated}`. Nil/exempt/non-GST split: all rows go to `exempt` bucket in v1; nil-rated and non-GST stubbed with zero aggregates (separate A10.1 ADR if pilot-shop auditor flags).
6. **doc** — document issued summary: one row per `doc_series` with `(nature_of_document, from_no, to_no, total_count, cancelled_count, net_issued)`. Nature = `Invoices for outward supply` (code `1`). Cancelled = `is_voided=1` bills. Gap detection included in summary metadata but not in JSON (GSTN doesn't accept gap markers in `doc`; we report gaps to the shop in the preview UI).

**Deferred (stubs, not in v1 JSON):**
- `cdnr/cdnur` (credit notes) — requires A15 refund/return flow. Empty arrays emitted to keep schema-valid.
- `b2ba/b2cla/b2csa/cdnra` (amendments) — requires A10.2 amendment tracking. Empty arrays.
- `exp` (exports), `at/ata/atadj/atadja` (advance tax) — out-of-scope for domestic retail pharmacy.

### Classification algorithm (locked, deterministic)
```
for bill in period where is_voided=0:
  if customer?.gstin and len(trim(customer.gstin))==15:
      → b2b  (+ lines → hsn_b2b bucket)
  elif bill.gst_treatment == 'inter_state' and bill.grand_total_paise > 1_00_00_000:
      → b2cl (+ lines → hsn_b2c bucket)
  else:
      → b2cs (+ lines → hsn_b2c bucket)

  if bill has any line with gst_rate=0 OR bill.gst_treatment in ('exempt','nil_rated'):
      → exemp (parallel; not exclusive with above — a bill may surface in b2b AND exemp
                if it mixes taxable and exempt lines — this matches GSTN's schema)
```

### Storage — migration 0014
```sql
-- bills gains two columns (nullable, back-compatible with A9 bills)
ALTER TABLE bills ADD COLUMN doc_series TEXT NOT NULL DEFAULT 'INV';
ALTER TABLE bills ADD COLUMN filed_period TEXT; -- e.g. '042026' (MMYYYY); NULL until filed

-- New table: one row per generated return
CREATE TABLE gst_returns (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  return_type     TEXT NOT NULL CHECK (return_type IN ('GSTR1')),
  period          TEXT NOT NULL,  -- 'MMYYYY'
  status          TEXT NOT NULL CHECK (status IN ('draft','filed','amended'))
                  DEFAULT 'draft',
  json_blob       TEXT NOT NULL,     -- full JSON payload string
  csv_b2b         TEXT NOT NULL,
  csv_b2cl        TEXT NOT NULL,
  csv_b2cs        TEXT NOT NULL,
  csv_hsn         TEXT NOT NULL,
  csv_exemp       TEXT NOT NULL,
  csv_doc         TEXT NOT NULL,
  hash_sha256     TEXT NOT NULL,     -- hash of json_blob for idempotency
  bill_count      INTEGER NOT NULL,
  grand_total_paise INTEGER NOT NULL,
  generated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  filed_at        TEXT,
  filed_by_user_id TEXT REFERENCES users(id),
  UNIQUE(shop_id, return_type, period, status)
);
CREATE INDEX idx_gst_returns_shop_period ON gst_returns(shop_id, period);
```

Regeneration semantics:
- Generating a period with an existing `status='draft'` row **overwrites** (same hash → no-op; different hash → UPDATE and bump `generated_at`).
- A `status='filed'` row is **immutable** — regeneration creates a new row with `status='amended'` instead, linked by same `(shop_id, return_type, period)` plus status discriminator.
- Filing (`mark_filed`) flips `draft → filed`, writes `filed_at` + `filed_by_user_id`, and back-fills `bills.filed_period` for every bill in the payload inside the same transaction.

Defense-in-depth: idempotency enforced via `UNIQUE(shop_id, return_type, period, status)` at DB level + hash comparison in Rust layer before UPDATE.

### Package — `@pharmacare/gstr1`
Pure TypeScript, zero runtime deps (matches invoice-print pattern). Structure:
```
packages/gstr1/
  package.json            // @pharmacare/gstr1@0.1.0
  src/
    types.ts              // GSTR1Payload + section types (B2BRow, B2CLRow, B2CSAggregate, HsnRow, ExempRow, DocRow)
    classify.ts           // bill → section dispatcher (pure fn, heavily tested)
    aggregate.ts          // B2CS / HSN / EXEMP aggregators (deterministic sort by keys)
    json.ts               // buildJson(period, shop, bills) → GSTR1Payload
    csv.ts                // buildCsv(*)        → per-section CSV strings (Tally-parity column order)
    format.ts             // formatRupees2Dp, formatPosCode, escapeCsv
    fixtures.ts           // test-only sample bills
    index.ts              // generateGstr1(input) orchestrator → { json, csv, summary }
```

**Key invariants:**
- All currency values in JSON are **rupees with 2-decimal precision** (GSTN schema) — the package converts paise (i64) → rupees (number fixed to 2dp via `Math.round(p/1) / 100` to avoid float drift). **The conversion is the package's sole floating-point operation; all arithmetic upstream stays in paise i64.**
- Sort order is deterministic (by `(hsn, gst_rate)` for HSN, `(pos, rate)` for B2CS, `(inum)` for B2B/B2CL, `(series, from_no)` for doc) so hashes are reproducible.
- `escapeCsv` follows RFC 4180 — comma, quote, CR, LF trigger quoting; quotes doubled inside quoted fields.

### Rust commands (commands.rs)
Three new commands, registered in `main.rs`:
```rust
generate_gstr1_payload(shop_id, period: String /* MMYYYY */) -> Result<GenerateGstr1Out, String>
  // Reads bills + composites (reuses get_bill_full's helper functions), calls TS
  // package through the desktop UI layer (Rust does NOT run TS; it hands JSON-ready
  // composite back to TS which calls @pharmacare/gstr1 and then calls save_gstr1_return).
  // Returns: { bills: Vec<BillFullOut>, shop: ShopFullOut, period }

save_gstr1_return(input: SaveGstr1ReturnIn) -> Result<GstReturnOut, String>
  // Persists the generated payload + CSVs + hash. Upsert draft; block overwrite of filed.

list_gst_returns(shop_id, return_type?: String) -> Result<Vec<GstReturnOut>, String>
mark_gstr1_filed(return_id) -> Result<GstReturnOut, String>
  // Flips status, writes filed_at, back-fills bills.filed_period.
```

Actor check: `mark_gstr1_filed` requires owner role (same F5-settings role model A13 uses for expiry override).

### UI — ReturnsScreen
- Route: main-nav Alt+0 (per ADR 0009 nav key scheme; Alt+digit is global).
  Note: draft of this ADR said Alt+5, but that slot was already bound to Directory;
  Returns therefore moved to Alt+0 (the only free digit).
- Period picker: month dropdown + year dropdown; defaults to prior month (current=Apr → pre-select Mar 2026).
- **F9** = Generate (invokes `generate_gstr1_payload` + `@pharmacare/gstr1` + `save_gstr1_return`).
- **F10** = Download JSON (GSTN offline-tool filename: `{MM}{YYYY}_GSTR1_{GSTIN}.json`).
- **F2** = Download CSV (opens an OS file dialog in Tauri; writes 6 CSVs into a zip: `b2b.csv, b2cl.csv, b2cs.csv, hsn.csv, exemp.csv, doc.csv`). **Zip assembly is pure TS via a bundled JSZip alternative — OR — v1 writes the 6 files to a timestamped folder instead to avoid adding a runtime dep.** Lock: **v1 writes to folder**; zip is a v1.1 polish.
- **F12** = Mark Filed (confirmation modal; owner-role gate).
- Preview: four tabs (B2B / B2CS / HSN / Docs) with counts + totals; invalid rows (missing HSN, missing GSTIN on B2B, gst_rate mismatch) get a red flag chip and block filing until fixed.

### Perf gate
`generate_gstr1_payload` for 5,000 bills (≈ a busy 1-location pharmacy's monthly volume) must complete in <2 s on Windows 7 / i3-8100 / 4GB / HDD. Aggregation is O(N) with sort at end (N log N on small N bucket); well within budget.

## Consequences
- Compliance-automatic gate (Hard Rule 5) moves from "promised" to "shipped" for the largest Indian filing obligation.
- Pilot-shop demo becomes: "We'll generate your GSTR-1 in 3 seconds every month, you click upload to gst.gov.in." This is the single most asked-for feature in deep-research interviews.
- Gap detection in the `doc` section surfaces cancelled/missing invoice numbers — useful audit surface for inspectors.
- Data lock-in reduced: the CSV export is Tally-parity, so shops can switch to or from PharmaCare Pro without losing filing history.
- Adds one migration (0014) and one new package; CI cost ≈ A8/A9 precedent (1-2 rustfmt round-trips budgeted).
- Opens the path for A12 (e-invoice IRN via Cygnet) which reuses the same composite bill-read pipeline.

## Alternatives considered
1. **Rust-side JSON generation** — rejected. TS package is easier to iterate on (schema churn is a regulatory reality), easier to test against fixtures, and doesn't cross the IPC boundary with a 20-field return struct. Rust owns DB-read + persist + actor-check; TS owns format.
2. **JSON-only, skip CSV** — rejected. Pilot shops' CAs work in Tally/Excel. CSV is mandatory for CA hand-off during the first 3-month trial while shops build confidence in our JSON.
3. **Use existing gst-engine for aggregation** — partially adopted. `gst-engine` handles per-line tax computation; A10 reuses its rate/treatment semantics but aggregation is new code in `@pharmacare/gstr1` (different data shape — list-of-bills → grouped-rows vs single-bill compute).
4. **Server-side filing via GSTN API directly** — rejected. LAN-first principle; also requires EVC/DSC which is the shop's private key, not ours. User uploads the JSON themselves; we never hold their GSTN credentials.
5. **Defer HSN-B2B/B2C split, merge into one HSN block** — rejected. 2025 GSTN change is enforced; pilot shops would see portal-upload errors.
6. **Store CSVs as separate rows** — rejected. 6 columns on one return row is simpler than a child table with type discrimination, and the CSVs are tiny (<100KB each for 5K-bill month).
7. **One-row-per-section in JSON schema** — that's actually how GSTN expects it: the JSON has `b2b`, `b2cl`, `b2cs`, `hsn`, `exemp`, `doc` as top-level keys whose values are arrays/objects per section. We follow the offline-tool JSON v1.3 layout.

## Locked constants
| Constant | Value | Source |
|---|---|---|
| `B2CL_THRESHOLD_PAISE` | `1_00_00_000` (₹1 L) | GSTN notification, effective Aug 2024 |
| `DEFAULT_DOC_SERIES` | `'INV'` | Repo convention |
| `DOC_NATURE_CODE` | `1` (Invoices for outward supply) | GSTN schema |
| `DEFAULT_UQC` | `'NOS'` | Pharmacy strips/bottles; UQC-per-product deferred to A10.1 |
| `GENERATE_PERF_BUDGET_MS` | `2000` @ 5K bills | Hard Rule 4 |
| `JSON_FILENAME_PATTERN` | `'{MM}{YYYY}_GSTR1_{GSTIN}.json'` | GSTN offline-tool default |
| `FISCAL_YEAR_FORMAT` | `'YYYY-YY'` (e.g. `2026-27`) | JSON field `fp` derived from period |

## Supersedes
None.

## Superseded-by
(future) ADR NNNN — A10.1 HSN UQC-per-product (strip/vial/bottle)
(future) ADR NNNN — A15 Credit notes + CDNR section
(future) ADR NNNN — A10.2 Amendment tracking (b2ba/b2cla/b2csa)
