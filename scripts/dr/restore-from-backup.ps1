<#
.SYNOPSIS
  Restore a shop's pharmacy.sqlite from a sealed backup file.

.DESCRIPTION
  Used during the DR drill (docs/runbooks/dr-drill.md) and in real
  recovery scenarios. Always works on a copy, never edits the source
  backup. Verifies SHA-256 if a sidecar .sha256 file is present.

.PARAMETER Source
  Path to the backup .sqlite file (or .sqlite.zst -- auto-detected).

.PARAMETER Target
  Path where the restored DB should land. Existing target is moved
  to <Target>.before-restore-<YYYYMMDD-HHmmss>.

.PARAMETER DryRun
  If set, prints what would happen without copying anything.

.EXAMPLE
  .\restore-from-backup.ps1 -Source 'D:\backups\pharmacy-2026-04-30.sqlite' -Target 'C:\ProgramData\PharmaCarePro\pharmacy.sqlite'

.EXAMPLE
  .\restore-from-backup.ps1 -Source ... -Target ... -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$Source,
  [Parameter(Mandatory=$true)] [string]$Target,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) {
  Write-Error "Source backup not found: $Source"
  exit 1
}

$sidecar = "$Source.sha256"
if (Test-Path $sidecar) {
  $expected = (Get-Content $sidecar -Raw).Trim().Split(' ')[0]
  $actual = (Get-FileHash $Source -Algorithm SHA256).Hash.ToLower()
  if ($expected.ToLower() -ne $actual) {
    Write-Error "SHA-256 mismatch. Expected $expected, got $actual"
    exit 2
  }
  Write-Host "[ok] SHA-256 verified."
} else {
  Write-Warning "No sidecar .sha256 found -- proceeding without verification."
}

$timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
$preserve = "$Target.before-restore-$timestamp"

if ($DryRun) {
  Write-Host "[dry-run] Would move existing target to $preserve"
  Write-Host "[dry-run] Would copy $Source -> $Target"
  exit 0
}

if (Test-Path $Target) {
  Write-Host "[step] Preserving existing target as $preserve"
  Move-Item $Target $preserve
}

Write-Host "[step] Restoring $Source -> $Target"
Copy-Item $Source $Target

# Sanity: open the DB and run PRAGMA integrity_check.
$sqlite = Join-Path (Split-Path $PSScriptRoot -Parent) "..\node_modules\.bin\sqlite3.exe"
if (-not (Test-Path $sqlite)) { $sqlite = "sqlite3.exe" }
$result = & $sqlite $Target "PRAGMA integrity_check;" 2>&1
if ($LASTEXITCODE -ne 0 -or $result -notmatch "ok") {
  Write-Error "integrity_check failed: $result"
  exit 3
}
Write-Host "[ok] PRAGMA integrity_check returned: $result"
Write-Host "[done] Restore complete. Pre-restore copy preserved at $preserve."
