<#
.SYNOPSIS
  Runs cargo bench and writes a summary JSON to tests\perf\.

.DESCRIPTION
  Used quarterly to populate tests\perf\baseline.json against the
  Section 10 GA-gate budgets. See ADR 0067 (perf harness).

  ASCII only -- Windows PowerShell 5.x ANSI parser breaks on UTF-8
  em-dashes in script bodies, so this file uses '--' throughout.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot "..\..")

$gitSha = $null
try {
    $gitSha = (& git rev-parse --short HEAD) 2>$null
} catch {
    $gitSha = $null
}
if (-not $gitSha) { $gitSha = "unknown" }

$ts  = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$out = "tests\perf\results-$gitSha-$ts.json"
$raw = Join-Path $env:TEMP "perf-$ts.raw"

New-Item -ItemType Directory -Path "tests\perf" -Force | Out-Null

Write-Host "[perf] running cargo bench (this takes 2-5 min)"
cargo bench `
    --manifest-path apps\desktop\src-tauri\Cargo.toml `
    -- --output-format json `
    *> $raw

Write-Host "[perf] writing summary to $out"
$summary = [ordered]@{
    git_sha             = $gitSha
    captured_at         = $ts
    captured_on_machine = $env:COMPUTERNAME
    raw_log             = $raw
    metrics             = @{ TODO = "parse criterion json output here" }
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -Path $out -Encoding ASCII
Write-Host "[done] $out"
