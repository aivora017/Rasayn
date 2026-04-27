# PharmaCare Pro - own-shop ship-readiness verifier.
# -----------------------------------------------------------------------------
# Run on your dev laptop AFTER `git pull origin main`. Walks the
# SHIP_READINESS_CHECKLIST sections A + B, stopping on the first red.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/own-shop-verify.ps1
#
# Exits 0 on green, non-zero on first failure.
# ASCII only - PowerShell + Windows console don't decode UTF-8 em-dash / section sign cleanly.

[CmdletBinding()]
param(
  [switch]$SkipRust,
  [switch]$SkipBuild,
  [string]$LogFile = "$env:TEMP\pharmacare-verify-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
)

$ErrorActionPreference = "Stop"
function Section($n, $title) { Write-Host "`n=== Section $n - $title ===" -ForegroundColor Cyan }
function Step($msg)         { Write-Host "  - $msg" -ForegroundColor Yellow }
function Pass($msg)         { Write-Host "    OK  $msg" -ForegroundColor Green }
function Fail($msg) {
  Write-Host "    FAIL $msg" -ForegroundColor Red
  Write-Host "Stopping. Fix the failure, then re-run." -ForegroundColor Red
  exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "Repo: $repoRoot"
Write-Host "Log:  $LogFile"

Section "A.0" "Tooling check"
Step "node --version"
$nodeV = & node --version 2>&1
if ($LASTEXITCODE -ne 0) { Fail "node not found on PATH" }
Pass $nodeV

Step "npm --version"
$npmV = & npm --version 2>&1
if ($LASTEXITCODE -ne 0) { Fail "npm not found on PATH" }
Pass $npmV

if (-not $SkipRust) {
  Step "cargo --version"
  $cargoV = & cargo --version 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "cargo not found (use -SkipRust to bypass)" }
  Pass $cargoV
}

Section "A.1" "npm install"
Step "Running npm install (offline-preferred)"
& npm install --prefer-offline --no-audit --no-fund 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "npm install failed; see $LogFile" }
Pass "deps installed"

Section "A.2" "turbo build all packages"
Step "Running npx turbo run build --filter=@pharmacare/*"
& npx turbo run build --filter='@pharmacare/*' 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "turbo build failed; see $LogFile" }
Pass "21 workspace packages built"

Section "A.3" "vitest sweep"
Step "Running npm test"
& npm test 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "vitest reported failures; see $LogFile" }
Pass "vitest sweep green"

if (-not $SkipRust) {
  Section "A.4" "cargo gate"
  Set-Location "$repoRoot\apps\desktop\src-tauri"
  Step "cargo fmt --check"
  & cargo fmt --check 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "cargo fmt failed; run 'cargo fmt' and retry" }
  Pass "fmt clean"

  Step "cargo clippy --all-targets -- -D warnings"
  & cargo clippy --all-targets -- -D warnings 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "clippy reported warnings; see $LogFile" }
  Pass "clippy clean"

  Step "cargo test --all"
  & cargo test --all 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "cargo tests failed; see $LogFile" }
  Pass "cargo tests pass"

  Step "cargo check --features cygnet-live (compile gate)"
  & cargo check --features cygnet-live 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "cygnet-live feature does not compile; see $LogFile" }
  Pass "cygnet-live compiles"

  Step "cargo check --features cleartax-live"
  & cargo check --features cleartax-live 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "cleartax-live feature does not compile; see $LogFile" }
  Pass "cleartax-live compiles"

  Set-Location $repoRoot
}

Section "A.5" "perf summary regenerate"
Step "node scripts/perf-summary.mjs"
& node scripts/perf-summary.mjs 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "perf-summary aggregator failed; see $LogFile" }
$summaryPath = Join-Path $repoRoot "docs\evidence\perf-summary.md"
if (-not (Test-Path $summaryPath)) { Fail "perf-summary.md not produced" }
Pass "$summaryPath written"

if (-not $SkipBuild) {
  Section "B.1" "tauri build (MSI)"
  Set-Location "$repoRoot\apps\desktop"
  Step "Running npm run tauri:build (slow - 5-15 min)"
  & npm run tauri:build 2>&1 | Tee-Object -Append -FilePath $LogFile | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "tauri build failed; see $LogFile" }
  $msi = Get-ChildItem -Recurse "src-tauri\target\release\bundle\msi" -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $msi) { Fail "No .msi produced under target/release/bundle/msi" }
  Pass "MSI: $($msi.FullName) ($([math]::Round($msi.Length / 1MB, 1)) MB)"
  Set-Location $repoRoot
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "ALL GATES GREEN - own-shop ship-ready." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Next: copy the MSI to your shop laptop + walk through SHIP_READINESS_CHECKLIST.docx section C onwards.`n"
exit 0
