# DR Drill — PharmaCare Pro

**Owner:** Sourav Shaw
**RTO target:** 30 minutes
**RPO target:** 5 minutes
**Frequency:** quarterly (Q1, Q2, Q3, Q4) + on every major release

This runbook covers the disaster-recovery drill we run to prove we can
rebuild a shop's local data and restore cloud-side state from backup.
The desktop POS is LAN-first, so most loss scenarios are
shop-localized. The drill exercises three layers in order: shop SQLite,
cloud-side license + telemetry, and storefront/issuance store.

## Scope

| Layer            | Source of truth         | Backup mechanism              | Restore script                        |
| ---------------- | ----------------------- | ----------------------------- | ------------------------------------- |
| Shop SQLite      | desktop pharmacy.sqlite | `backup_scheduler` (4×/day)   | scripts/dr/restore-from-backup.ps1    |
| Cloud telemetry  | Postgres (RDS)          | RDS automated snapshot        | scripts/dr/restore-cloud.sh           |
| License store    | JSON-lines / KV         | hourly cron → S3              | scripts/dr/restore-license-store.sh   |

## Drill steps

### 1. Pre-drill (T-30 min)

1. Announce drill in #incident channel — "Starting DR drill at HH:MM IST".
2. Take a fresh integrity-checked backup using the backup_scheduler Tauri
   command (`backup_scheduler_run_now`). Verify the SHA-256 matches the
   recorded one in the audit log.
3. Snapshot RDS: `aws rds create-db-snapshot --db-instance-identifier pharmacare-prod --db-snapshot-identifier dr-drill-$(date +%Y%m%d-%H%M)`.
4. Pull `licenses.jsonl` from production storefront host into a known-good
   location.

### 2. Simulate failure

Pick **one** of:

- **Shop SQLite corruption**: rename `pharmacy.sqlite` to `pharmacy.sqlite.broken`
  and the WAL/SHM files alongside.
- **Storefront host wipe**: stop the Vercel deployment + delete
  `licenses.jsonl` from disk.
- **RDS hardware loss**: spin a new RDS instance from snapshot in a
  different AZ.

### 3. Execute restore

For shop SQLite:

```powershell
.\scripts\dr\restore-from-backup.ps1 -Source 'D:\backups\pharmacy-2026-04-30-12-00.sqlite' -Target 'C:\ProgramData\PharmaCarePro\pharmacy.sqlite'
```

For storefront license store:

```bash
./scripts/dr/restore-license-store.sh s3://pharmacare-prod-backups/licenses.jsonl ./licenses.jsonl
```

For RDS:

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier pharmacare-prod-restored \
  --db-snapshot-identifier dr-drill-YYYYMMDD-HHMM
```

### 4. Verify

| Check                                 | How                                                   | Pass criteria                  |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| Bills count on shop SQLite            | `SELECT count(*) FROM bills`                          | matches pre-drill count ±0     |
| Latest bill timestamp                 | `SELECT max(created_at) FROM bills`                   | RPO ≤ 5min                     |
| License lookup `/api/license/lookup`  | curl with a known-good (key, email)                   | 200 + correct record           |
| ABDM consent token shape              | `SELECT count(*) FROM abdm_profiles`                  | matches pre-drill count        |
| App boot + login                      | open desktop, login as owner                          | no schema errors               |

### 5. Close

1. Document elapsed time (target: ≤ 30 min from "execute restore" start to
   all checks green).
2. File any deviation as a P1 issue with the `dr-drill` label.
3. Roll back the simulation: switch back to the pre-drill DB / snapshot.
4. Update this runbook with anything that surprised you.

## Drill log

| Date       | Driver  | Scenario              | Elapsed | Pass? | Notes                                          |
| ---------- | ------- | --------------------- | ------- | ----- | ---------------------------------------------- |
| 2026-04-30 | Sourav  | Shop SQLite corruption | TBD     | TBD   | First drill — establish baseline               |

Update this table after every drill.

## Acceptance for §10 GA gate

A drill is considered "passed" when:

- Elapsed time from failure simulation to all-green checks ≤ 30 min.
- All four verify checks above pass.
- No data loss beyond the RPO window (5 min).
- Drill log entry filled in within 24h of completion.
