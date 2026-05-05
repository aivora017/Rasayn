# scripts/perf/run-perf.ps1
# PharmaCare Pro perf harness (ADR 0067, Section 10 GA gate).
# PowerShell 5.x compatible. ASCII-only by design (PS 5.x ANSI parser
# trips on smart quotes / em-dashes / non-ASCII glyphs in script bodies).
#
# Runs cargo bench for cold_start + bill_save with bencher output,
# parses p50/p95 (median + std-dev approximation), captures host info,
# and writes a JSON results file under tests\perf\results\.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# Repo root = two levels up from this script.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $RepoRoot

# --- Identifiers ---------------------------------------------------------
$gitSha = 'unknown'
try {
    $sha = & git rev-parse --short HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $sha) { $gitSha = $sha.Trim() }
} catch { $gitSha = 'unknown' }

$nowUtc = [DateTime]::UtcNow
$tsUtc  = $nowUtc.ToString('yyyyMMdd_HHmmss')
$tsIso  = $nowUtc.ToString("yyyy-MM-ddTHH:mm:ssZ")

$resultsDir = Join-Path $RepoRoot 'tests\perf\results'
if (-not (Test-Path $resultsDir)) {
    New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
}
$outPath = Join-Path $resultsDir ("results-{0}-{1}.json" -f $gitSha, $tsUtc)
$rawPath = Join-Path $env:TEMP ("perf-bencher-{0}.txt" -f $tsUtc)

# --- Host info -----------------------------------------------------------
$hostName = $env:COMPUTERNAME
if (-not $hostName) { $hostName = 'unknown' }

$cpuModel = 'unknown'
try {
    $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop | Select-Object -First 1
    if ($cpu -and $cpu.Name) { $cpuModel = $cpu.Name.Trim() }
} catch {
    try {
        $cpu = wmic cpu get Name /value 2>$null | Select-String '^Name='
        if ($cpu) { $cpuModel = ($cpu -replace '^Name=','').Trim() }
    } catch {}
}

$ramMb = 0
try {
    $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    if ($cs -and $cs.TotalPhysicalMemory) {
        $ramMb = [int]([math]::Round($cs.TotalPhysicalMemory / 1MB))
    }
} catch {}

$disk = 'unknown'
try {
    $sysDriveLetter = ($env:SystemDrive).TrimEnd(':')
    $part = Get-Partition -DriveLetter $sysDriveLetter -ErrorAction Stop | Select-Object -First 1
    if ($part) {
        $pd = Get-PhysicalDisk -ErrorAction Stop |
              Where-Object { $_.DeviceId -eq $part.DiskNumber.ToString() } |
              Select-Object -First 1
        if ($pd) {
            switch -Regex ($pd.MediaType) {
                'SSD'   { $disk = 'ssd';     break }
                'HDD'   { $disk = 'hdd';     break }
                default { $disk = 'unknown'; break }
            }
        }
    }
} catch { $disk = 'unknown' }

$osVer = 'unknown'
try {
    $oi = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    if ($oi) { $osVer = ($oi.Caption + ' ' + $oi.Version).Trim() }
} catch {}

Write-Host "[perf] git_sha=$gitSha ts=$tsIso"
Write-Host "[perf] host=$hostName cpu='$cpuModel' ram_mb=$ramMb disk=$disk os='$osVer'"
Write-Host "[perf] running cargo bench (this takes 5-8 min on i3-8100)"

# --- Run benches ---------------------------------------------------------
$tauriDir = Join-Path $RepoRoot 'apps\desktop\src-tauri'
$benchRc  = 0
Push-Location $tauriDir
try {
    & cargo bench --bench cold_start --bench bill_save -- --output-format bencher *>&1 |
        Tee-Object -FilePath $rawPath | Out-Host
    $benchRc = $LASTEXITCODE
} catch {
    $benchRc = 1
} finally {
    Pop-Location
}

# --- Parse bencher output via inline Python -----------------------------
# We avoid Get-Content / Set-Content for raw bencher text and let Python
# read the temp file directly (UTF-8) and write the result JSON. The
# script body itself stays ASCII so PS 5.x cannot mis-decode it.
$parserPath = Join-Path $env:TEMP ("perf-parse-{0}.py" -f $tsUtc)
$parserBody = @"
import json, re, sys

raw_path, out_path, ts, sha, host, cpu, ram, disk, os_ver, rc = sys.argv[1:11]

with open(raw_path, 'r', encoding='utf-8', errors='replace') as f:
    raw = f.read()

rx = re.compile(
    r'test\s+(?P<name>\S+)\s+\.\.\.\s+bench:\s+'
    r'(?P<med>[\d,]+)\s+ns/iter\s+\(\+/-\s+(?P<dev>[\d,]+)\)'
)

def metric_for(needle):
    for m in rx.finditer(raw):
        if needle in m.group('name'):
            med = int(m.group('med').replace(',', '')) / 1_000_000.0
            dev = int(m.group('dev').replace(',', '')) / 1_000_000.0
            return {'p50': round(med, 3), 'p95': round(med + dev * 1.645, 3), 'samples': 100}
    return {'p50': None, 'p95': None, 'samples': 0}

doc = {
    'version': 1,
    'captured_at': ts,
    'git_sha': sha,
    'host_info': {
        'hostname': host,
        'cpu': cpu,
        'ram_mb': int(ram) if ram.isdigit() else 0,
        'disk': disk,
        'os': os_ver,
    },
    'metrics': {
        'cold_start_ms': metric_for('cold_start'),
        'bill_save_ms':  metric_for('bill_save'),
    },
    'bench_exit_code': int(rc) if rc.lstrip('-').isdigit() else -1,
    'raw_bencher_output': raw,
}

with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(doc, f, indent=2, sort_keys=True)
    f.write('\n')
"@

# Write parser as UTF-8 without BOM (PS 5.x default would add BOM).
[System.IO.File]::WriteAllText($parserPath, $parserBody, (New-Object System.Text.UTF8Encoding $false))

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $py) { throw "python (or python3) is required on PATH for run-perf.ps1" }

& $py.Source $parserPath $rawPath $outPath $tsIso $gitSha $hostName $cpuModel $ramMb $disk $osVer $benchRc

Remove-Item -Path $parserPath -Force -ErrorAction SilentlyContinue

Write-Host "[done] $outPath"
Write-Output $outPath
