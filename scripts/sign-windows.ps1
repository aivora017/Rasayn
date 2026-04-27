# PharmaCare Pro — Windows Authenticode signing wrapper (DigiCert EV).
# -----------------------------------------------------------------------------
# This script is invoked by `tauri build` for every produced .exe / .msi.
# It supports three signing backends, selected via environment variables:
#
#  1. DigiCert KeyLocker  (recommended for CI; HSM in the cloud)
#       SIGNING_MODE=keylocker
#       SM_HOST, SM_API_KEY, SM_CLIENT_CERT_FILE, SM_CLIENT_CERT_PASSWORD
#       SM_CODE_SIGNING_CERT_SHA1_HASH
#  2. Local hardware token (manual builds on Sourav's laptop with YubiKey)
#       SIGNING_MODE=token
#       SIGNING_CERT_THUMBPRINT (40-char hex)
#  3. Skip            (dev builds; produces unsigned installer)
#       SIGNING_MODE=skip
#
# Usage from Tauri:
#   tauri.conf.json -> bundle.windows.signCommand =
#     "powershell -ExecutionPolicy Bypass -File scripts/sign-windows.ps1 -File %1"

param(
  [Parameter(Mandatory=$true)] [string]$File
)

$ErrorActionPreference = "Stop"
$mode = $env:SIGNING_MODE
if ([string]::IsNullOrWhiteSpace($mode)) {
  Write-Host "[sign] SIGNING_MODE unset — defaulting to 'skip' (dev build)"
  $mode = "skip"
}
if (-not (Test-Path $File)) {
  throw "[sign] file not found: $File"
}

switch ($mode) {
  "keylocker" {
    Write-Host "[sign] keylocker → $File"
    foreach ($k in @("SM_HOST","SM_API_KEY","SM_CLIENT_CERT_FILE","SM_CLIENT_CERT_PASSWORD","SM_CODE_SIGNING_CERT_SHA1_HASH")) {
      if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($k))) {
        throw "[sign] keylocker requires env var: $k"
      }
    }
    $signtool = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
    if (-not (Test-Path $signtool)) {
      $signtool = "signtool.exe"
    }
    & $signtool sign `
      /sm /tr "http://timestamp.digicert.com" /td sha256 /fd sha256 `
      /sha1 $env:SM_CODE_SIGNING_CERT_SHA1_HASH `
      $File
    if ($LASTEXITCODE -ne 0) { throw "[sign] signtool exited $LASTEXITCODE" }
  }

  "token" {
    Write-Host "[sign] token → $File"
    $thumb = $env:SIGNING_CERT_THUMBPRINT
    if ([string]::IsNullOrWhiteSpace($thumb)) {
      throw "[sign] token mode requires SIGNING_CERT_THUMBPRINT"
    }
    & signtool.exe sign /tr "http://timestamp.digicert.com" /td sha256 /fd sha256 /sha1 $thumb $File
    if ($LASTEXITCODE -ne 0) { throw "[sign] signtool exited $LASTEXITCODE" }
  }

  "skip" {
    Write-Host "[sign] skip — leaving '$File' unsigned (dev build)"
  }

  default {
    throw "[sign] unknown SIGNING_MODE: $mode (expected: keylocker | token | skip)"
  }
}
