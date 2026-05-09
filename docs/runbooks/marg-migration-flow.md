# Marg → Rasayn Migration Flow

**Owner:** Sourav Shaw
**Frequency:** once per pilot shop (Day-1 install, T-3 days)
**Target:** Vaidyanath Pharmacy, Kalyan (first run); subsequent pilots reuse this exact flow.
**References:** `pilot-day-1-install.md`, FORWARD_PLAN_v4 §4 (S29), `packages/migration-import/`.

## When to run

- **T-3 days** before Day-1 install: founder collects the CSV exports from the pharmacy owner (Marg ERP).
- **T-2 days**: dry-run on the founder rig with `--dry-run` to surface all skip/error rows.
- **T-1 day**: real import into a clean `app.db`; one day of dual-running locally to verify totals match Marg.
- **Day-0**: ship the rig with the populated DB to the shop.

The flow is one-shot per shop. Re-runs are safe (INSERT OR IGNORE on the
synthesised `marg-<shop_id>-<ProductCode>` id), but should only be needed if
the owner sends a refreshed CSV.

## How to obtain the CSV from Marg

In the Marg ERP terminal at the pharmacy:

1. **Reports** → **Item Reports** → **Item Master / Stock Statement**
2. Filter: **All items, with stock**, current date.
3. **Export** → **CSV** (NOT XLS — XLS adds locale formatting that breaks parse).
4. Save as `marg-products-YYYY-MM-DD.csv` to a USB stick.

Expected columns (Marg item-master):
`ProductCode, ItemName, Mfr, Pack, BatchNo, Expiry, MRP, PurchaseRate, Stock, HSN, GST, Schedule, Composition`.

If the owner's Marg version emits a different header set, run with `--dry-run`
once and inspect stderr — the CLI logs each unmapped column as a `warn:` line.

## Founder command at the rig

```powershell
# 1. dry-run first (no DB writes; per-row report on stdout)
node --import tsx/esm packages\migration-import\src\cli.ts `
  --from-marg "C:\Users\Jagannath Pharmacy\Desktop\marg-products-2026-08-11.csv" `
  --to        "$env:APPDATA\PharmaCare\app.db" `
  --shop-id   shop_main `
  --dry-run

# 2. real import (after dry-run is clean)
node --import tsx/esm packages\migration-import\src\cli.ts `
  --from-marg "C:\Users\Jagannath Pharmacy\Desktop\marg-products-2026-08-11.csv" `
  --to        "$env:APPDATA\PharmaCare\app.db" `
  --shop-id   shop_main
```

After build (`pnpm -F @pharmacare/migration-import build`) the binary is also
available as `pharmacare-import` on the PATH.

## Common parse errors and fixes

| stderr line | Cause | Fix |
|---|---|---|
| `source ... looks binary, not CSV (exit 3)` | Owner exported XLS, not CSV | Re-export from Marg as CSV |
| `no data rows in CSV` | Empty file or only header | Verify Marg filter; widen date range |
| `SKIP row N: bad expiry "..."` | Locale date (DD/MM/YYYY or DD-MMM-YY) | Open CSV in Excel, set Expiry column to YYYY-MM-DD, re-save |
| `SKIP row N: missing code/MRP` | Row has no ProductCode or MRP=0 | Owner cleanup: delete defunct items in Marg first |
| First byte `0xFE 0xFF` (UTF-16 BOM) | Marg exported as UTF-16 | Re-save as UTF-8 in Notepad → Save As → Encoding: UTF-8 |
| Stray `;` separators | Owner has European Marg locale | Open in Excel → Save As CSV (comma-separated) |

## Marg → Rasayn column map

| Marg column   | Rasayn target            | Notes |
|---|---|---|
| ProductCode   | products.id (synthesised `marg-<shop_id>-<code>`) | Idempotency key |
| ItemName      | products.name            | Required |
| Mfr           | products.manufacturer    | Defaults to "Unknown" if blank |
| Pack          | products.pack_form       | "10x10" / "1x100ml" etc., kept verbatim |
| BatchNo       | batches.batch_no         | Required |
| Expiry        | batches.expiry_date      | YYYY-MM-DD; mfg_date set to first-of-month |
| MRP           | products.mrp_paise / batches.mrp_paise | × 100 to paise |
| PurchaseRate  | batches.purchase_price_paise | × 100 to paise |
| Stock         | batches.qty_on_hand      | INTEGER |
| HSN           | products.hsn             | 8-digit; defaults to "00000000" |
| GST           | products.gst_rate        | Coerced to one of {0,5,12,18,28} |
| Schedule      | products.schedule        | Normalised to OTC/H/H1/X by adapter |
| Composition   | (dropped)                | Not in v0.1 schema; future: products.composition |

`batches.supplier_id` is set to `--shop-id` (self-supplier placeholder); the
real supplier table is populated separately from the Marg supplier export.

## Post-import verification

```powershell
# count what was imported
node -e "const D=require('better-sqlite3');const d=new D(process.env.APPDATA+'\PharmaCare\app.db');console.log('products:',d.prepare('SELECT COUNT(*) c FROM products').get().c);console.log('batches:',d.prepare('SELECT COUNT(*) c FROM batches').get().c);"

# sample top 20
node -e "const D=require('better-sqlite3');const d=new D(process.env.APPDATA+'\PharmaCare\app.db');console.table(d.prepare('SELECT id,name,manufacturer,mrp_paise FROM products LIMIT 20').all());"
```

If counts don't match the dry-run summary line (`<ok> ok, <skip> skipped`),
investigate before shipping. A mismatch usually means a Schedule-H row
tripped the `image_sha256` trigger (X2 moat) — those rows need an image
captured during onboarding before insert.
