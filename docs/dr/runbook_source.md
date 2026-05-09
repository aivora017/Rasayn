# PharmaCare Pro - Disaster Recovery Runbook

Owner: Sourav Shaw
RTO target: 30 minutes. RPO target: 5 minutes.
Last updated: 2026-05-08 (S28.A6)

This is the source markdown that the .docx is generated from. Keep them in
sync. The .docx is the version Sourav prints and carries on the founder USB
to Vaidyanath Pharmacy on May 13.

---

## 1. What this runbook covers

This runbook is the definitive procedure for getting PharmaCare Pro back
to a working state after data loss, hardware loss, or a security incident
that requires a clean rebuild.

Recovery objectives (per PROJECT_INSTRUCTIONS §10 GA gate):
- **RTO** (recovery time objective): under 30 minutes from incident to
  shop-running again.
- **RPO** (recovery point objective): under 5 minutes of data loss.

Reach those targets by combining:
- 30-minute on-disk snapshots (the existing `backup_scheduler` loop).
- 02:00 nightly tar.zst snapshots to the external SSD (this runbook).
- WAL tail replayed automatically on restart.

CERT-In trigger: any incident that involves an unauthorised data access,
data integrity break, ransomware, or system compromise must be reported
to CERT-In within 6 hours per PROJECT_INSTRUCTIONS §8. See §7 below.

**Verify**: after reading §1, confirm you can name the RTO, RPO, and
CERT-In window in 10 seconds.

## 2. Snapshot setup at install (Day 1)

When you install PharmaCare Pro at a new shop:

1. Plug in the operator-supplied external SSD; note its drive letter
   (`D:` or `E:`).
2. Set `PHARMACARE_BACKUP_DIR=<drive>:\pharmacare-backups` as a system
   environment variable.
3. Open the app, sign in as owner, run `dr_take_snapshot` from the DR
   screen ("Settings -> Backup -> Snapshot Now"). Confirm the green
   "snapshot ok" toast and write the SHA-256 fingerprint into the install
   log.
4. Register the 02:00 scheduled task using the PowerShell snippet in
   `scripts/dr/README.md`.
5. Open the task in Task Scheduler, "Run" once manually to confirm the
   task fires and lands a second snapshot.

**Verify**: list the backup dir; you should see two snapshots and two
matching `.sha256` sidecars.

## 3. Verifying snapshots

You should be able to verify a snapshot in under 60 seconds.

1. Open the app, "Settings -> Backup -> List Snapshots". Each row shows
   path, size, created_at, shop_id, and sha256_match. All `sha256_match`
   rows should be green.
2. From PowerShell:
   ```powershell
   .\scripts\dr\restore.ps1 -Source <path> -DryRun
   ```
   The dry-run verifies sha256 and stages the contents without swapping
   into place.
3. Manual inspection: open the .tar.zst with 7-Zip; confirm
   `pharmacy.sqlite`, `uploads/`, `crypto/keyring/`, `.env` are all
   present and `logs/`, `target/`, `node_modules/`, `.git/` are absent.

**Verify**: pick one snapshot, confirm sha256 matches sidecar, list
contents.

## 4. P1 - Restore from yesterday's snapshot (10-20 minutes)

Use this when the live DB is corrupted or a bad release wrote bad data
but the OS install is healthy.

1. Sign out all users; close PharmaCare Pro from the system tray.
2. Identify the desired snapshot (latest known-good before the issue).
3. Run:
   ```powershell
   .\scripts\dr\restore.ps1 -Source <path-to-snapshot.tar.zst>
   ```
4. The script verifies sha256, stages the tarball, and atomically swaps
   into `%APPDATA%\PharmaCarePro\`. Pre-restore copy is preserved at
   `%APPDATA%\PharmaCarePro.before-restore-<timestamp>` for rollback.
5. Restart PharmaCare Pro. Sign in as owner.
6. Run "Settings -> Diagnostics -> Integrity Check"; expect "ok".
7. Spot-check: search for a known recent bill, an open khata account, a
   product master entry.

**Verify**: integrity_check returns "ok"; spot-checks pass; elapsed
under 20 minutes.

## 5. P0 - Full re-install + restore (30-45 minutes)

Use this when the OS install is also gone (HDD/SSD failure, fresh image).

1. Re-install PharmaCare Pro on the same hardware from the signed MSI.
2. Sign in as owner; the app prompts for license key + machine
   fingerprint match.
3. Plug in the external SSD with the snapshots.
4. Quit the app from the system tray.
5. Run `restore.ps1` against the latest snapshot (see §4 step 3).
6. Restart the app.
7. Re-bind printers, scales, and barcode readers (the registry entries
   live outside the snapshot).
8. Run a full validation pass per `docs/runbooks/perf-drill-jagannath.md`
   §3.

**Verify**: app boots; integrity_check ok; first bill saves in <500ms;
print test prints; license shows "valid" status.

## 6. Catastrophic - laptop lost or stolen (Phase 2 - GAP)

**Scope gap**: cloud-replicated snapshots are NOT in the May 13 pilot
scope. If the shop laptop is lost or stolen TODAY, the only recoverable
artefacts are whatever lives on the external SSD that the founder
carries off-site at end of day.

Mitigation until Phase 2:

1. Founder takes the external SSD home each night (mandatory at the
   pilot shop).
2. SSD is encrypted with BitLocker (Win 11 Pro built-in).
3. Recovery key is in the founder's password manager + a sealed
   envelope at the lawyer's office.

When the new hardware is provisioned:

1. Re-install the signed MSI.
2. Restore from the most recent SSD snapshot per §5.
3. Re-issue the license against the new machine fingerprint via the
   storefront `/api/license/rebind` endpoint (DPDP-logged, requires
   owner OTP).

Phase 2 (post-pilot) wires up Backblaze B2 + age-encrypted snapshots so
the SSD is no longer the only off-site copy. Tracked as `S30 cloud-DR`.

## 7. CERT-In 6-hour incident notification

Trigger conditions (PROJECT_INSTRUCTIONS §8):
- Unauthorised data access (we read someone else's shop data, or someone
  reads ours).
- Ransomware encryption of the data dir.
- Tampering with audit logs or chain-of-custody.
- Loss of physical hardware that holds production data without
  encryption confirmation.

What to file:
- **Who**: CERT-In incident reporting form, https://www.cert-in.org.in/
- **When**: within 6 hours of detection.
- **What**: incident summary, affected shop_id (NOT customer data),
  detection timeline, containment actions, snapshot integrity status,
  upstream notifications already made (lawyer + DPO).

Contact path:
1. Founder pages the DPO (per `_research_brain/06_pilot/dpo_contacts.md`).
2. DPO files the CERT-In form within 4 hours; founder cross-checks.
3. If owner shop is the source of compromise, founder gets owner sign-off
   on the customer-facing breach disclosure within 12 hours per DPDP s.8(6).

**Verify**: the DPO contact phone + lawyer contact phone are written
into your phone before pilot-go-live.

## 8. Drill schedule

- **Frequency**: quarterly, plus on every major release.
- **Owner**: founder (Sourav Shaw) until first hire.
- **Logging**: append a row to
  `_research_brain/06_pilot/dr_drills.md` within 24 hours.
- **Pass criteria**: elapsed under 30 minutes, all four verify checks
  in `docs/runbooks/dr-drill.md` §4 green, no data loss outside RPO.

The first dress-rehearsal is Sunday 2026-05-10 (see §9).

## 9. Sun May 10 dress rehearsal

See `docs/dr/restore_smoke_test.md` for the 1-page rehearsal script.
Sourav runs the full P1 + P0 path on a clone Win 11 VM with the same
attached SSD. Target elapsed: 35 minutes (10 min P1 + 25 min P0).

If the rehearsal fails any verify step, treat it as a release blocker
for May 13 pilot-go-live and escalate to the founder + DPO immediately.

**Verify**: dr_drills.md has a fresh row dated 2026-05-10 with status
PASS by Sunday evening.
