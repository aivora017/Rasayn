# Restore smoke test - Sun 2026-05-10 dress rehearsal

Owner: Sourav Shaw
Target elapsed: 35 minutes (10 min P1 + 25 min P0).
Pass criteria: every "expect" line below is met. Any miss = release blocker.

## Setup (T-15 min)

1. Spin a clone Win 11 VM from the Day-1 install image.
2. Plug the external SSD with the latest production-cadence snapshots.
3. Sign in as the owner test account.
4. Confirm `dr_list_snapshots` shows at least 14 nightly snapshots, all
   with `sha256_match: true`. Expect: 14+ rows, all green.

## P1 path - corrupt DB recovery (10 min target)

1. Stop PharmaCare Pro from system tray.
2. Rename `%APPDATA%\PharmaCarePro\pharmacy.sqlite` to
   `pharmacy.sqlite.broken`. Touch a 0-byte `pharmacy.sqlite` to simulate
   corruption.
3. From PowerShell:
   ```powershell
   .\scripts\dr\restore.ps1 -Source <latest snapshot path>
   ```
4. Restart the app. Sign in.
5. "Settings -> Diagnostics -> Integrity Check". Expect: "ok".
6. Search for the most recent test bill saved on Saturday. Expect: found,
   total matches the seed value.

Stop the clock. **Expect**: under 10 minutes elapsed.

## P0 path - full re-install (25 min target)

1. Wipe the VM data dir: `rmdir /s /q %APPDATA%\PharmaCarePro`.
2. Uninstall PharmaCare Pro from "Apps & features".
3. Re-install from the signed MSI on the SSD.
4. Sign in as owner; provide the license key from the test license vault.
5. Quit the app from system tray.
6. Run `restore.ps1` against the latest snapshot.
7. Restart. Sign in. Confirm:
   - Integrity check ok.
   - First search returns under 200 ms.
   - First saved bill returns under 500 ms.
   - Print test prints to the bound printer.
   - License "valid" status in the footer.

Stop the clock. **Expect**: under 25 minutes elapsed.

## Failure path

If any expect line misses:

1. Capture screen + log dir tarball.
2. Open a P0 issue with label `dr-drill-fail` and attach evidence.
3. Page the founder.
4. Treat May 13 pilot-go-live as blocked until the regression is closed.

## Drill log entry (paste into `_research_brain/06_pilot/dr_drills.md`)

| Date | Driver | Scenario | Elapsed | Pass? | Notes |
| ---- | ------ | -------- | ------- | ----- | ----- |
| 2026-05-10 | Sourav | P1 + P0 on clone VM | TBD | TBD | First S28.A6 dress rehearsal |
