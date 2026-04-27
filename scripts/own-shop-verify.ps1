# PharmaCare Pro - own-shop ship-readiness verifier.
# -----------------------------------------------------------------------------
# Run on your dev laptop AFTER `git pull origin main`. Walks the
# SHIP_READINESS_CHECKLIST sections A + B, stopping on the first red.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/own-shop-verify.ps1
#
# ASCII only. We do NOT set $ErrorActionPreference=Stop because npm/cargo
# write benign deprecation warnings to stderr; under Stop those become
# fatal NativeCommandError exceptions. Instead every native call is
# followed by an explicit $LASTEXITCODE check.

[CmdletBinding()]
param(
  [switch]$SkipRust,
  [switch]$SkipBuild,
  [string]$LogFile = "$env:TEMP\pharmacare-verify-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
)

# Native-command stderr is plumbed through the success stream; we don't
# want PowerShell to surface it as red error text.
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

function Section($n, $title) { Write-Host "`n=== Section $n - $title ===" -ForegroundColor Cyan }
function Step($msg)         { Write-Host "  - $msg" -ForegroundColor Yellow }
function Pass($msg)         { Write-Host "    OK  $msg" -ForegroundColor Green }
function Fail($msg) {
  Write-Host "    FAIL $msg" -ForegroundColor Red
  Write-Host "Stopping. Fix the failure, then re-run." -ForegroundColor Red
  Write-Host "Log: $LogFile" -ForegroundColor Red
  exit 1
}

# Run a native command, capturing stdout+stderr, log to file, echo to console.
# Returns the exit code; never throws.
function Invoke-Native {
  param([string]$Cmd, [string[]]$ArgList)
  $output = & $Cmd @ArgList 2>&1 | ForEach-Object { $_.ToString() }
  $code = $LASTEXITCODE
  $output | Add-Content -Path $LogFile
  $output | ForEach-Object { Write-Host $_ }
  return $code
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
Step "npm install (offline-preferred)"
$rc = Invoke-Native "npm" @("install", "--prefer-offline", "--no-audit", "--no-fund")
if ($rc -ne 0) { Fail "npm install exit=$rc; see $LogFile" }
Pass "deps installed"

Section "A.2" "turbo build all packages"
Step "npx turbo run build --filter=@pharmacare/*"
$rc = Invoke-Native "npx" @("turbo", "run", "build", "--filter=@pharmacare/*")
if ($rc -ne 0) { Fail "turbo build exit=$rc; see $LogFile" }
Pass "21 workspace packages built"

Section "A.3" "vitest sweep"
Step "npm test"
$rc = Invoke-Native "npm" @("test")
if ($rc -ne 0) { Fail "vitest reported failures (exit=$rc); see $LogFile" }
Pass "vitest sweep green"

if (-not $SkipRust) {
  Section "A.4" "cargo gate"
  Set-Location "$repoRoot\apps\desktop\src-tauri"

  Step "cargo fmt --check"
  $rc = Invoke-Native "cargo" @("fmt", "--check")
  if ($rc -ne 0) { Fail "cargo fmt failed; run 'cargo fmt' and retry" }
  Pass "fmt clean"

  Step "cargo clippy --all-targets -- -D warnings"
  $rc = Invoke-Native "cargo" @("clippy", "--all-targets", "--", "-D", "warnings")
  if ($rc -ne 0) { Fail "clippy reported warnings (exit=$rc); see $LogFile" }
  Pass "clippy clean"

  Step "cargo test --all"
  $rc = Invoke-Native "cargo" @("test", "--all")
  if ($rc -ne 0) { Fail "cargo tests failed (exit=$rc); see $LogFile" }
  Pass "cargo tests pass"

  Step "cargo check --features cygnet-live"
  $rc = Invoke-Native "cargo" @("check", "--features", "cygnet-live")
  if ($rc -ne 0) { Fail "cygnet-live feature does not compile; see $LogFile" }
  Pass "cygnet-live compiles"

  Step "cargo check --features cleartax-live"
  $rc = Invoke-Native "cargo" @("check", "--features", "cleartax-live")
  if ($rc -ne 0) { Fail "cleartax-live feature does not compile; see $LogFile" }
  Pass "cleartax-live compiles"

  Set-Location $repoRoot
}

Section "A.5" "perf summary regenerate"
Step "node scripts/perf-summary.mjs"
$rc = Invoke-Native "node" @("scripts/perf-summary.mjs")
if ($rc -ne 0) { Fail "perf-summary aggregator failed; see $LogFile" }
$summaryPath = Join-Path $repoRoot "docs\evidence\perf-summary.md"
if (-not (Test-Path $summaryPath)) { Fail "perf-summary.md not produced" }
Pass "$summaryPath written"

if (-not $SkipBuild) {
  Section "B.1" "tauri build (MSI)"
  Set-Location "$repoRoot\apps\desktop"
  Step "npm run tauri:build (slow - 5-15 min)"
  $rc = Invoke-Native "npm" @("run", "tauri:build")
  if ($rc -ne 0) { Fail "tauri build exit=$rc; see $LogFile" }
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
