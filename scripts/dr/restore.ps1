<#
.SYNOPSIS
  DR restore driver (Windows native) - S28.A6.

.DESCRIPTION
  Verifies SHA-256 against sidecar, untars to a staging dir, atomically
  swaps into the live data dir, then runs PRAGMA integrity_check on the
  restored DB. Caller stops the desktop app first (see runbook).

.PARAMETER Source
  Path to the snapshot .tar.zst (or .tar.gz fallback).

.PARAMETER DataDir
  The PharmaCarePro live data directory. Defaults to
  $env:APPDATA\PharmaCarePro.

.PARAMETER DryRun
  Stage and verify without swapping into place.

.EXAMPLE
  .\restore.ps1 -Source 'D:\pharmacare-backups\pharmacare-snapshot-2026-05-08-0200-shop_main.tar.zst'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$Source,
  [string]$DataDir = (Join-Path $env:APPDATA 'PharmaCarePro'),
  [switch]$DryRun
)

Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) {
  Write-Error "snapshot not found: $Source"
  exit 1
}

$sidecar = "$Source.sha256"
if (Test-Path $sidecar) {
  $expected = (Get-Content $sidecar -Raw).Trim().Split(' ')[0].ToLower()
  $actual = (Get-FileHash $Source -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    Write-Error "sha256 mismatch. Expected $expected got $actual"
    exit 2
  }
  Write-Host "[ok] sha256 verified"
} else {
  Write-Warning "no sidecar at $sidecar -- proceeding without verification"
}

$stage = Join-Path $env:TEMP ("pharmacare-restore-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Write-Host "[step] staging into $stage"

if ($Source -like '*.tar.zst') {
  $zstd = (Get-Command zstd -ErrorAction SilentlyContinue)
  if (-not $zstd) { Write-Error 'zstd required to extract .tar.zst'; exit 3 }
  $tarTmp = [System.IO.Path]::GetTempFileName()
  & zstd -d -o $tarTmp $Source
  & tar -xf $tarTmp -C $stage
  Remove-Item $tarTmp -Force
} elseif ($Source -like '*.tar.gz') {
  & tar -xzf $Source -C $stage
} else {
  Write-Error "unknown snapshot format: $Source"
  exit 4
}

if ($DryRun) {
  Write-Host "[dry-run] would swap $stage -> $DataDir"
  exit 0
}

$ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$preserve = "$DataDir.before-restore-$ts"
if (Test-Path $DataDir) {
  Move-Item $DataDir $preserve
  Write-Host "[step] preserved old as $preserve"
}
Move-Item $stage $DataDir

$db = Join-Path $DataDir 'pharmacy.sqlite'
if (Test-Path $db) {
  $sqlite = (Get-Command sqlite3.exe -ErrorAction SilentlyContinue)
  if ($sqlite) {
    $r = & sqlite3.exe $db 'PRAGMA integrity_check;'
    if ($r -ne 'ok') { Write-Error "integrity_check failed: $r"; exit 5 }
    Write-Host "[ok] integrity_check: $r"
  } else {
    Write-Warning "sqlite3.exe not on PATH - skipped integrity_check (run manually)"
  }
}
Write-Host "[done] restored. pre-restore copy at $preserve"
