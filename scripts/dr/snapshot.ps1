<#
.SYNOPSIS
  DR snapshot driver (Windows native) - S28.A6.

.DESCRIPTION
  Produces pharmacare-snapshot-YYYY-MM-DD-HHmm-{shop_id}.tar.zst plus a
  .sha256 sidecar in $env:PHARMACARE_BACKUP_DIR. Includes pharmacy.sqlite,
  uploads/, crypto/keyring/, .env config. Excludes logs/, target/,
  node_modules/, .git/.

  Default backup target is the operator-attached external SSD per Q-014.

.PARAMETER DryRun
  If set, prints the plan but writes nothing.

.EXAMPLE
  .\snapshot.ps1
.EXAMPLE
  .\snapshot.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [switch]$DryRun
)

Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

$DataDir = if ($env:PHARMACARE_DATA_DIR) { $env:PHARMACARE_DATA_DIR } else {
  Join-Path $env:APPDATA 'PharmaCarePro'
}
$BackupDir = if ($env:PHARMACARE_BACKUP_DIR) { $env:PHARMACARE_BACKUP_DIR } else {
  'D:\pharmacare-backups'
}
$ShopId = if ($env:PHARMACARE_SHOP_ID) { $env:PHARMACARE_SHOP_ID } else { 'unknown' }
$Ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd-HHmm')
$Name = "pharmacare-snapshot-$Ts-$ShopId.tar.zst"
$Out = Join-Path $BackupDir $Name

if (-not (Test-Path $DataDir)) {
  Write-Error "data dir not found: $DataDir"
  exit 1
}

if ($DryRun) {
  Write-Host "[dry-run] would write $Out"
  Write-Host "[dry-run] excludes: logs target node_modules .git"
  exit 0
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$tar = (Get-Command tar -ErrorAction SilentlyContinue)
$zstd = (Get-Command zstd -ErrorAction SilentlyContinue)
if (-not $tar) {
  Write-Error "tar not found on PATH (Win10+ ships it; install via 'winget install GnuWin32.Tar')"
  exit 2
}

$excludeArgs = @(
  '--exclude=logs',
  '--exclude=target',
  '--exclude=node_modules',
  '--exclude=.git'
)

if ($zstd) {
  $tarTmp = [System.IO.Path]::GetTempFileName()
  & tar @excludeArgs -cf $tarTmp -C $DataDir .
  & zstd -19 -o $Out $tarTmp
  Remove-Item $tarTmp -Force
} else {
  Write-Warning "zstd not found; falling back to .tar.gz"
  $Out = $Out -replace '\.tar\.zst$','.tar.gz'
  & tar @excludeArgs -czf $Out -C $DataDir .
}

$Sha = (Get-FileHash $Out -Algorithm SHA256).Hash.ToLower()
"$Sha  $(Split-Path $Out -Leaf)" | Set-Content -Path "$Out.sha256" -Encoding ASCII
Write-Host "[ok] $Out"
Write-Host "[ok] sha256=$Sha"
