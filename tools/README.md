# tools/ -- synthetic Vaidyanath Pharmacy fixtures

These CSVs simulate a real Marg ERP "Item-Master export -> CSV" file as
shipped by Vaidyanath Pharmacy, Kalyan, the launch-day pilot for the S28
sprint window (pilot date 2026-05-13).

They are NOT real customer data. Generated deterministically by
`gen_synthetic_vaidyanath.py` (seed `20260508`) so anyone re-running the
script gets byte-identical output.

## Files

| File                                  | Rows | Purpose                                                        |
| ------------------------------------- | ---- | -------------------------------------------------------------- |
| `synthetic-vaidyanath-master.csv`     |  566 | ~500 SKUs + multi-batch duplicate `ItemCode`s (66 batch dupes) |
| `synthetic-vaidyanath-customers.csv`  |  200 | Customers, ~50% with GSTIN, mixed phone formats                |
| `synthetic-vaidyanath-suppliers.csv`  |   30 | Distributors with DLNo + GSTIN                                 |

The shape mirrors the column order Marg's "Export to Excel/CSV" wizard
emits when an Indian pharmacy with the standard item-master template
exports its inventory.

## Marg-export edge cases the master CSV deliberately contains

Every one of these is something a real Vaidyanath/Jagannath export has
been observed to throw. The hardened importer
(`packages/migration-import/src/harden.ts`) must tolerate ALL of them:

- UTF-8 BOM at file start (Excel-saved CSVs)
- CRLF line endings
- Quoted fields with embedded commas (addresses)
- Devanagari mixed with English (e.g. `Crocin 500mg टॅब`)
- Stray whitespace around HSN codes (`"  30049099  "`)
- HSN of length 4 (`3004`) -> padded to 8 (`30040000`)
- Empty `ScheduleClass` cell -> treated as OTC
- Mixed date formats per row: `31/12/2024`, `31-Dec-2024`, `31/12/24`,
  `31.12.2024`
- `INR` / `Rs.` / Rupee-symbol currency prefix on rates
- Duplicate `ItemCode` over multiple rows (multi-batch -- same product,
  different `BatchNo`)
- Manufacturer name variants: `Cipla` / `CIPLA` / `Cipla Ltd`
- A small fraction of expired batches (5%) and near-expiry batches (10%)
  -- must import + flag, not drop

## SKU mix

| Slice          | %   | Notes                                                   |
| -------------- | --- | ------------------------------------------------------- |
| Generic OTC    | 60% | Paracetamol, Cetirizine, Vitamin D3, etc.               |
| Branded OTC    | 25% | Crocin, Combiflam, Becosules                            |
| Schedule H     | 10% | Antibiotics, antihypertensives                          |
| Schedule H1    |  4% | Diazepam, Tramadol                                      |
| Schedule X     |  1% | Methadone, Morphine                                     |

HSN distribution: ~85% `30049099`, ~10% `30039011`, ~5% short codes
(`3003`, `3004`) to exercise the HSN normalizer.

GST distribution: `{0, 5, 12, 18}` -- never `28%` (legitimate medicines
never carry the highest slab).

ExpDate distribution: 5% expired, 10% within 90 days, 85% future.

## Regenerate

```bash
python3 tools/gen_synthetic_vaidyanath.py
```

Outputs all three CSVs to `tools/`. Idempotent -- same seed every time,
no network access, ~50ms runtime.

To bump the dataset (e.g. add 1000 SKUs instead of 500), edit `N_SKUS` /
`N_CUSTOMERS` / `N_SUPPLIERS` at the top of the script.

## How the importer consumes these

```bash
# Dry-run against the synthetic master:
pnpm --filter @pharmacare/migration-import import \
  --from-marg tools/synthetic-vaidyanath-master.csv \
  --to /tmp/test.db \
  --shop-id vph-001 \
  --dry-run
```

Or programmatically -- see
`packages/migration-import/src/harden.test.ts` for the
`adaptMargItemMasterCsvHardened` invocation against this fixture; that
test is the integration contract.
