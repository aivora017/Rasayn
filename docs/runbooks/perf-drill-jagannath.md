# Perf Drill - Jagannath Pharmacy (Kalyan pilot rig)

**Owner:** Sourav Shaw
**Frequency:** once per release candidate before GA, then quarterly
**Target rig:** Lenovo i3-8100 / 4 GB RAM / Win 11 Pro at Vaidyanath/Jagannath Pharmacy, Kalyan
**Time budget:** 90 minutes door-to-door (incl. travel)
**References:** ADR-0067 (perf harness), Playbook v2.0 §10 (GA gate), `tests/perf/baseline.json`

## Purpose

Replace the synthetic Linux-sandbox numbers in `tests/perf/baseline.json` with
real measurements taken on the production reference rig at Jagannath Pharmacy.
The baseline gates GA per Playbook v2.0 §10:

- **cold_start total < 3000 ms** (migrations <= 1500 ms, UI <= 1500 ms)
- **bill_save p95 < 400 ms** (warm DB, single-shop)

The Linux-container synthetic baseline (committed in S24.2) is a
**non-pilot reference floor only** - it documents what the harness emits
and lets `check-baseline.py` smoke-test against numbers, but it does NOT
satisfy the §10 GA gate. Only this drill produces GA-grade evidence.

## Prerequisites

- Repo cloned at `C:\src\pharmacare-pro` (or equivalent) on the rig.
- `rustup` toolchain installed; `cargo --version` works in PowerShell.
- Python 3.8+ on PATH (used by `run-perf.ps1` to parse bencher output).
- Git installed; you can `git pull origin main` from the rig.
- Reference rig present and idle: Lenovo ThinkCentre / IdeaCentre i3-8100,
  4 GB RAM, spinning HDD or SSD (record which), Windows 11 Pro fully patched.
- Physical access to the shop during low-traffic hours (post 21:00 IST works).
- USB stick or remote pipe to copy results JSON back to laptop.

## Procedure (10 steps, target: 90 min including travel)

1. **Power-cycle the rig.** Hard reboot, then wait 60 s after the desktop
   appears so background services (indexer, OneDrive, etc.) settle.
2. **Disable Windows Update + Defender real-time scan.**
   Settings -> Privacy & Security -> Windows Security -> Virus & threat
   protection -> Manage settings -> toggle **Real-time protection** OFF.
   Also pause Windows Update for 1 hour. **Set a phone alarm to re-enable
   in step 9** - this is non-negotiable.
3. **Open elevated PowerShell** at the cloned repo root
   (`Start -> PowerShell -> Run as administrator`, then `cd C:\src\pharmacare-pro`).
4. **Sync to the candidate sha:** `git pull origin main`. Confirm
   `git rev-parse --short HEAD` matches the sha on your laptop.
5. **Clear any stale lock:**
   `Remove-Item .git\index.lock -Force -EA SilentlyContinue`.
6. **Run the harness:** `.\scripts\perf\run-perf.ps1`. Expect 5-8 minutes
   on i3-8100; the script tees bencher output to console and writes JSON
   to `tests\perf\results\results-<sha>-<utcstamp>.json`. Note the path
   it echoes at the end.
7. **Sanity-check the JSON.** Open the emitted file in VS Code or Notepad.
   Eyeball both numbers:
   - `metrics.cold_start_ms.p95` should be **< 3000**
   - `metrics.bill_save_ms.p95`  should be **< 400**
   If either is wildly off (>2x budget) abort and jump to **Rollback**.
8. **Promote to baseline.** Either:
   - `python scripts\perf\promote-baseline.py tests\perf\results\results-<sha>-<utc>.json`
     (atomic, preserves §10 `budget_ms` and `sla_origin`), OR
   - manually copy the JSON over `tests\perf\baseline.json` and hand-edit
     to keep the existing `budget_ms` / `sla_origin` keys intact.
9. **Re-enable Defender real-time scan and resume Windows Update.**
   Same path as step 2; toggle real-time protection back ON. Confirm
   the green tick in the Security center before you walk out.
10. **Commit and push from the rig:**
    `git add tests/perf/baseline.json`
    `git commit -m "perf(s24): first real baseline from Jagannath Pharmacy rig"`
    `git push origin main`. Open a PR titled
    `perf(s24): real Jagannath baseline` linking ADR-0067.

## Acceptance gates

| Metric                  | Budget   | On miss                                                   |
|-------------------------|----------|-----------------------------------------------------------|
| `cold_start_ms.p95`     | < 3000   | **Block GA**. Open P0 issue tagged `perf,ga-gate`.        |
| `bill_save_ms.p95`      | < 400    | **Block GA**. Open P0 issue tagged `perf,ga-gate`.        |
| `cold_start_ms` >+10% vs prior baseline | n/a | File P1 regression issue; do not block GA on its own. |
| `bill_save_ms` >+10% vs prior baseline  | n/a | File P1 regression issue; do not block GA on its own. |
| Either p95 is `null`    | n/a      | Bench did not produce data; rerun. Do not promote.        |

`scripts/perf/check-baseline.py` automates this matrix; CI should call it
on every PR that touches `apps/desktop/src-tauri/**` or
`packages/shared-db/migrations/**`.

## Rollback

If the drill produces pathological numbers (cold_start >6 s, bill_save
>1 s, or NaN), do **not** promote.

1. Discard the bad results JSON: `Remove-Item tests\perf\results\results-*.json`
   (keep the old baseline as-is).
2. Verify `tests/perf/baseline.json` is unchanged: `git status`,
   `git diff tests/perf/baseline.json` should be empty.
3. Re-run the harness in step 6 once more after another power-cycle, in
   case the rig was thermal-throttling or under disk-IO contention.
4. If the second run also misses budget, file a P0 perf regression issue
   citing the candidate sha and stop the GA train. Do **not** push a
   regressed baseline just to "make CI green" - the baseline is the
   §10 evidence and must reflect reality.
5. Roll real-time Defender back ON (step 9) regardless of outcome.

## Operator notes

- Keep a printed copy of this runbook in the shop's binder so anyone
  with admin access can finish the drill if Sourav is unreachable mid-run.
- The script is idempotent; re-running on the same sha just produces a
  new timestamped results file. The baseline only changes when
  `promote-baseline.py` (or a hand copy) overwrites it.
- Network is not required for the bench itself; only `git pull` and the
  final `git push` need internet.
