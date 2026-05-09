# scripts/dr - Disaster Recovery driver scripts

Owner: Sourav Shaw (S28.A6)
RTO target: 30 minutes. RPO target: 5 minutes.

These scripts are the OS-level half of the DR pathway documented in
`docs/dr/runbook.docx`. The Tauri-side commands live in
`apps/desktop/src-tauri/src/dr.rs` (`dr_take_snapshot`,
`dr_restore_snapshot`, `dr_list_snapshots`).

## Files

| File | OS | Purpose |
|------|----|---------|
| `snapshot.sh` | Linux/WSL | Take a tar.zst snapshot of the data dir + sidecar SHA-256. |
| `snapshot.ps1` | Windows | Same as above, native PowerShell. |
| `restore.sh` | Linux/WSL | Verify sha256 + untar + atomic swap + PRAGMA integrity_check. |
| `restore.ps1` | Windows | Same, native PowerShell. |
| `verify.sh` | Linux/WSL | Standalone verifier (sidecar match) + post-restore sanity. |

The legacy `restore-from-backup.ps1` and `restore-license-store.sh` are
retained for compatibility with the existing quarterly drill runbook
(`docs/runbooks/dr-drill.md`).

## ENV vars

| Var | Default | Notes |
|-----|---------|-------|
| `PHARMACARE_BACKUP_DIR` | `D:\pharmacare-backups` (Win) / `/mnt/ssd/pharmacare-backups` (POSIX) | External SSD per Q-014 default. |
| `PHARMACARE_DATA_DIR`   | `%APPDATA%\PharmaCarePro` (Win) / `~/.local/share/PharmaCarePro` (POSIX) | App data root. |
| `PHARMACARE_SHOP_ID`    | `unknown` | Used for the snapshot filename. |

## Snapshot naming

`pharmacare-snapshot-YYYY-MM-DD-HHmm-{shop_id}.tar.zst`
plus a `.sha256` sidecar with the same basename + `.sha256`.

Includes: `pharmacy.sqlite`, `uploads/`, `crypto/keyring/`, `.env`.
Excludes: `logs/`, `target/`, `node_modules/`, `.git/`.

## Snapshot retention

Applied automatically after each `dr_take_snapshot` Tauri call:
- last 14 nightly
- last 4 weekly (latest snapshot per ISO week)
- last 12 monthly (latest snapshot per calendar month)
- prune everything else (the `.sha256` sidecar goes with it)

## Usage

```bash
# Linux / WSL
./snapshot.sh                                  # nightly cron driver
./restore.sh /mnt/ssd/pharmacare-backups/pharmacare-snapshot-2026-05-08-0200-shop_main.tar.zst
./verify.sh  /mnt/ssd/pharmacare-backups/pharmacare-snapshot-2026-05-08-0200-shop_main.tar.zst
./verify.sh --post-restore "$HOME/.local/share/PharmaCarePro"
```

```powershell
# Windows
.\snapshot.ps1
.\restore.ps1 -Source 'D:\pharmacare-backups\pharmacare-snapshot-2026-05-08-0200-shop_main.tar.zst'
.\snapshot.ps1 -DryRun
```

## Scheduling

- **Windows**: register a scheduled task at 02:00 local. Example:
  ```powershell
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\PharmaCarePro\scripts\dr\snapshot.ps1'
  $trigger = New-ScheduledTaskTrigger -Daily -At 2am
  Register-ScheduledTask -TaskName 'PharmaCare DR Snapshot' -Action $action -Trigger $trigger -RunLevel Highest
  ```
- **WSL/Linux**: cron entry `0 2 * * * /opt/pharmacare/scripts/dr/snapshot.sh`.

## CERT-In 6-hour notification

If a restore is required because of a security incident, file a CERT-In
notification per PROJECT_INSTRUCTIONS §8 within 6 hours of detection.
See runbook §7 for the exact procedure.
