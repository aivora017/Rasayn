# Pilot Exit Gates — Day-1 + Day-30

**Owner:** Sourav Shaw, founder
**Authority:** Playbook v2.0 §9 (pilot rules) + §10 (GA gate)
**Applies to:** every pilot under the first-10 cohort (perpetual ₹14,999 + AMC ₹4,999)
**Scope:** machine-checkable definition of when a pilot is "officially live" (Day-1) and "officially shipped" (Day-30). One row in the pilot tracker per gate.

---

## Why this document exists

§9 ("First 10 pilots: direct founder sales, ₹0 CAC, 3-month free, onsite Day-1 install, 48h hotline, parallel run with legacy for 2 weeks, 30-bill zero-discrepancy gate") and §10 ("Definition of Done — GA") name the gates but do not pin them to artifacts. This document does. Every gate below maps to a file the founder produces or a runbook the founder executes; missing artifact = gate not met.

If you cannot point to the file that proves the gate, the gate is not green. No verbal sign-offs.

---

## Day-1 acceptance — pilot is "live"

Captured at the end of the install visit. All seven rows must be Y. If any is N, the shop reverts to legacy and the visit is rescheduled (per `pilot-day-1-install.md` §Rollback).

| # | Gate | Evidence file | Pass criterion |
|---|---|---|---|
| D1-1 | Power + network OK | `docs/pilot-tracker/<shop>/day-1-checklist.md` § Power | mains 220V±10%; gateway pingable |
| D1-2 | Installer ran with valid Authenticode signature | screenshot of installer dialog → `docs/pilot-tracker/<shop>/day-1-evidence/installer-signed.png` | DigiCert EV signature visible, "PharmaCare Technologies Pvt Ltd" |
| D1-3 | License activated | row in `pilot-tracker/licenses.csv` | shop_id, gstin, retail_license, license_sha, activated_at all populated |
| D1-4 | Fixture seed succeeded | `pharmacare-cli seed` exit 0 + screenshot | seed report stamped in evidence dir |
| D1-5 | Printer + CFD paired | test receipt photographed | physical receipt with "TEST PRINT" + shop GSTIN visible |
| D1-6 | First real-customer bill saved + printed | `bills` table row count ≥ 1 (verify via `pharmacare-cli bills count --shop-id <id>`) | exit 0 with count ≥1 |
| D1-7 | Owner + cashier walkthrough done | signed acceptance form | shop owner signature + date in `docs/pilot-tracker/<shop>/day-1-evidence/acceptance.pdf` |

**Day-1 is green** when all seven rows = Y AND `pilot-tracker/<shop>/status.md` is updated to `live` with the Day-1 date.

**Cross-references:**
- Procedure: `docs/runbooks/pilot-day-1-install.md`
- Leave-behind: `docs/runbooks/pilot-leave-behind-kit.md`
- Hotline activation: `docs/runbooks/pilot-48h-hotline.md`

---

## Day-7 interim check — early-warning

Not a gate; a checkpoint. Catches problems early so Day-14/30 gates aren't ambushed. Founder phones the shop owner; 5 yes/no questions. Logged in `docs/pilot-tracker/<shop>/day-7-checkin.md`.

| # | Question | Bad answer triggers |
|---|---|---|
| D7-1 | Has the receipt printer worked every day this week? | hardware-failure runbook + onsite spare printer |
| D7-2 | Has the cashier needed the laminated card? Which sections? | training one-pager v2 in next sprint |
| D7-3 | Has any bill saved wrong (line, qty, total)? | P0 hotpatch + 30-bill gate likely fails |
| D7-4 | Has any customer complained about the receipt format? | invoice-print template revision |
| D7-5 | Has the hotline been called? Severity? | hotline log review + improve self-service script |

---

## Day-14 measurement gate — 30-bill zero-discrepancy

The §9 hard gate. Run the discrepancy script (`scripts/pilot/measure-30-bills.py`) against the parallel-run CSV the owner has been filling since Day-1.

**Exact command (PowerShell on field laptop or shop rig):**
```powershell
py scripts\pilot\measure-30-bills.py `
  --db "C:\Users\<user>\AppData\Roaming\PharmaCare\app.db" `
  --paper-csv docs\pilot-tracker\<shop>\parallel-run-bills.csv `
  --shop-id <shop_id> `
  --since 2026-04-15 `
  --limit 30 `
  --out docs\pilot-tracker\<shop>\day-14-gate-evidence.md
```

| # | Gate | Evidence | Pass |
|---|---|---|---|
| D14-1 | Script exit 0 | terminal output | exit 0 = §9 PASS |
| D14-2 | Report markdown captured | `docs/pilot-tracker/<shop>/day-14-gate-evidence.md` | file exists, 30 rows |
| D14-3 | Report CSV captured | sibling `.csv` | file exists |
| D14-4 | Owner counter-signed PDF | `day-14-gate-evidence.pdf` | shop-owner signature page |

If exit code is **1** (gate FAIL with non-rounding discrepancies), the protocol is:
1. Categorize the discrepancy class (the script does this — read `## Summary` of the report)
2. 5-whys root cause within 24h
3. P1 hotpatch in next sprint
4. Re-run gate after fix lands; clock resets to Day-14 from re-run date

If exit code is **2** (insufficient sample), the script still emits a partial report. Slip Day-14 to Day-21 max; if still under 30, escalate to slow-pilot review (likely shop volume below ICP threshold of ₹8L monthly GMV).

**Cross-reference:** `docs/runbooks/30-bill-gate-evidence.md` for the precise tolerance table.

---

## Day-30 sign-off — pilot is "shipped"

The §9 success-gate-per-pilot trio plus §10 evidence captured. All five rows must be Y to count this shop in the `paying_shops_live > 30_days` GA-gate count.

| # | Gate | Source of truth | Pass criterion |
|---|---|---|---|
| D30-1 | Billing uptime ≥ 95% | `pharmacare-cli uptime --shop-id <id> --since <day-1-date>` | exit 0 with uptime ≥ 0.95 |
| D30-2 | GSTR-1 export filed on our export | screenshot of GST portal acknowledgment | ARN number visible + matches our `gstr1_exports.json` checksum |
| D30-3 | NPS survey returned, score ≥ 50 | `docs/pilot-tracker/<shop>/nps-survey.md` | numeric score, owner verbatim quote |
| D30-4 | Perf baseline captured at this rig | `tests/perf/results-<sha>-<utc>.json` (per `docs/runbooks/perf-drill-jagannath.md`) | cold-start p95 < 3000 ms; bill-save p95 < 400 ms |
| D30-5 | DR drill rehearsed at this rig | `docs/pilot-tracker/<shop>/dr-drill-<date>.md` | RTO ≤30 min, RPO ≤5 min, restore script exit 0 |

**Day-30 is green** when all five rows = Y AND `pilot-tracker/<shop>/status.md` is updated to `shipped` with the Day-30 date.

**Cross-references:**
- Perf: `docs/runbooks/perf-drill-jagannath.md`, `scripts/perf/run-perf.ps1`, `scripts/perf/check-baseline.py`
- DR: `docs/runbooks/dr-drill.md`
- 30-bill: `docs/runbooks/30-bill-gate-evidence.md`

---

## Pilot-cohort roll-up (the §5 / §10 gate)

Phase-1 exit (Months 0-3) requires Vaidyanath shipped (1/1).
Phase-2 gate (Months 3-6) requires 10 shops shipped, ₹5-15L MRR, NPS ≥40 cohort-average.
Phase-3 gate (Months 12-18) requires 100 shops shipped > 30 days, 0 P0 > 24h, ≥₹8L MRR.

The cohort tracker lives at `docs/pilot-tracker/cohort-rollup.md` — auto-generated by `scripts/pilot/rollup-cohort.py` (deferred to S25.5; manual maintenance until then).

---

## What "officially shipped" does NOT mean

This document defines the founder-side acceptance gate. It does NOT mean:
- The shop has zero open issues (P2/P3 are allowed; P1 must be resolved or have a written waiver from the owner)
- The shop is on a paid plan (first 10 pilots are 3-month free per §9; conversion is a separate sales gate)
- All AMC obligations are scoped (AMC starts Day-1 of paid period, not Day-1 of pilot)
- Marketing can name the shop publicly (separate written consent — DPDP §2 hard rule)

---

## Sign-off log

When a pilot crosses Day-30 with all gates green, append a row to `docs/pilot-tracker/sign-off-log.md`:

```
| date | shop_id | shop_name | gstin | day-1 date | day-14 date | day-30 date | NPS | uptime | notes |
```

Vaidyanath is row 1.
