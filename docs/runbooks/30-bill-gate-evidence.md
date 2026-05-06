# Runbook — 30-Bill Gate Evidence (Playbook §9)

## Purpose
Capture §9 pilot success-gate evidence: 30 sequential bills from the
2-week parallel-run period must match the legacy system (Marg / Tally /
paper) line-for-line, paise-for-paise, with **zero** non-rounding
discrepancies. Push-button: one CSV the owner fills, one Python script
the founder runs, one Markdown report PASS/FAIL the bank/investor sees.

## What to capture
The owner-filled parallel-run CSV at
`docs/templates/parallel-run-csv-template.csv`. One row per bill the
cashier rings up on the legacy system AND on PharmaCare during the
2-week parallel-run window. Both totals are recorded so the script can
diff them. The PharmaCare side is queried directly from `app.db` —
nothing to fill in twice.

## When to start
**Day-1**, immediately after install. The owner starts filling the
parallel-run CSV from the very first bill. The cashier is briefed: ring
the same bill on both systems, write the legacy invoice number into
PharmaCare's `bill_no` field exactly so the join is trivial.

## When to measure
- **Day-7 (informal interim).** Run the script with `--limit 10` to spot
  systemic drift early. If anything is off, fix in the same week.
- **Day-14 (gate measurement).** Run with `--limit 30`. This is the
  gate. Result PDF goes to `docs/pilot-tracker/<shop>/day-14-gate-evidence.pdf`.
- **Day-30 (founder sign-off).** Re-run on the now-larger sample (limit
  60 or 90) to confirm the gate didn't pass on a fluke.

## How to run (PowerShell, field laptop)
Python 3.8+ stdlib only — no pip install needed.

```powershell
# Once: ensure Python 3.8+ is on PATH.
py -V    # expect: Python 3.8.x or newer

# Each measurement:
cd C:\PharmaCare\pharmacare-pro
py scripts\pilot\measure-30-bills.py `
  --db "$env:APPDATA\PharmaCare\app.db" `
  --paper-csv .\docs\pilot-tracker\<shop>\parallel-run-bills.csv `
  --shop-id shop_main `
  --since 2026-04-15 `
  --limit 30 `
  --out .\docs\pilot-tracker\<shop>\discrepancy-report-<shop>-<date>.md
echo $LASTEXITCODE   # 0=PASS  1=FAIL  2=tooling-error
```

If Python is missing on the field laptop:
1. Download Python 3.11 from python.org → tick "Add to PATH".
2. Verify with `py -V`. No other dependencies required.

## What zero-discrepancy means precisely
| Field | Tolerance | Why |
|---|---|---|
| total_paise | ±50 paise (rounding) | Indian pharmacy convention rounds to nearest rupee; bills.round_off_paise CHECK enforces ±50 |
| line count | exact | Missing/extra line is a real bug |
| qty per line | exact | A different qty silently sells the wrong amount |
| unit_price_paise | ±0 | Price drift = NPPA risk |
| gst_rate | ±0 | GST mismatch is a compliance event |
| payment_mode | exact | UPI vs cash recorded differently is a real bug; khata→credit normalised app-side |
| sku/product_id | "compatible" — same product even if alias name | Soft match because paper might say "Crocin 500" while app says "Paracetamol 500mg"; logged as `line_sku_mismatch` but does NOT fail the gate |

The script categorises each discrepancy. The §9 gate fails on any of:
`total_paise_mismatch`, `line_count_mismatch`, `line_qty_mismatch`,
`line_unit_price_mismatch`, `line_gst_rate_mismatch`,
`payment_mode_mismatch`. `rounding_only` and `line_sku_mismatch` are
logged but do NOT fail the gate.

## What if 30 bills aren't ready by Day-14
Gate slips, but only as far as Day-21. Measure on whatever is
sequentially captured; document the calendar gap in the report. If the
shop has not produced 30 bills by Day-21, the pilot is failing on
adoption — escalate that, not the gate.

## Failure handling
If any non-rounding discrepancy is found:
1. Capture the exact discrepancy class from the Markdown report.
2. Run a 5-whys on the discrepancy (e.g., wrong GST rate seeded?
   wrong batch picked? cashier typo?).
3. File as a P1 issue in the sprint board, fix in the next sprint.
4. Re-run the gate after the fix lands. The gate is "30 sequential
   bills, zero non-rounding discrepancies" — re-runs start a fresh
   30-count.

## Sign-off
- Owner signs the discrepancy report (printed Markdown → PDF).
- Founder counter-signs.
- Final PDF stays in `docs/pilot-tracker/<shop>/day-14-gate-evidence.pdf`.
- The sibling `.csv` goes into the bank/investor evidence pack.

## File reference
- Template the owner fills:   `docs/templates/parallel-run-csv-template.csv`
- Script:                     `scripts/pilot/measure-30-bills.py`
- Sample fixtures:            `scripts/pilot/sample/`
- Per-shop pilot folder:      `docs/pilot-tracker/<shop>/`
