<#
.SYNOPSIS
  Smoke-tests the DR restore script without touching any real DB.
  Used by CI to ensure the runbook scripts haven't bit-rotted.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "dr-drill-$([Guid]::NewGuid())")
try {
  $fakeDb = Join-Path $tmp "fake.sqlite"
  $fakeBackup = Join-Path $tmp "fake-backup.sqlite"
  Set-Content -Path $fakeDb     -Value "fake-current"
  Set-Content -Path $fakeBackup -Value "fake-backup"

  # Dry-run should not move/copy anything.
  & "$PSScriptRoot\restore-from-backup.ps1" -Source $fakeBackup -Target $fakeDb -DryRun
  if ((Get-Content $fakeDb) -ne "fake-current") {
    throw "DryRun modified target -- should not."
  }
  Write-Host "[ok] dry-run leaves target untouched"
  Write-Host "[done] dry-run-test passed"
} finally {
  Remove-Item -Recurse -Force $tmp
}
