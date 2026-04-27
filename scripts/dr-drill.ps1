# PharmaCare Pro — DR drill automation.
# -----------------------------------------------------------------------------
# Exercises the disaster-recovery path end-to-end:
#   1. Take a fresh on-demand backup of the live DB.
#   2. Note current bill count + last bill no.
#   3. Simulate corruption: rename live DB out of the way.
#   4. Run db_restore via the tauri-cli (or directly via sqlite3 if app is offline).
#   5. Re-validate: bill count + last bill no match the backup snapshot.
#   6. Roll back if any step fails.
#
# Targets the Day-30 DR-drill gate (Pilot SOP §5).
# RTO target: ≤30 min from "DB unreadable" to "shop billing again".
# RPO target: ≤5 min (worst-case data loss = backup interval).

[CmdletBinding()]
param(
  [string]$DbPath = "$env:APPDATA\PharmaCarePro\pharmacare.db",
  [string]$BackupDir = "$env:APPDATA\PharmaCarePro\backups",
  [string]$DrillLog = "$env:APPDATA\PharmaCarePro\dr-drill-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
)

$ErrorActionPreference = "Stop"
$start = Get-Date
function Log([string]$msg) {
  $line = "$(Get-Date -Format 'HH:mm:ss')  $msg"
  Write-Host $line
  Add-Content -Path $DrillLog -Value $line
}

Log "=== DR drill starting ==="
Log "DbPath:    $DbPath"
Log "BackupDir: $BackupDir"
Log "Log:       $DrillLog"

if (-not (Test-Path $DbPath)) { throw "Live DB not found: $DbPath" }

# --- Step 1: fresh backup -----------------------------------------------------
$snap = Join-Path $BackupDir "drill-$(Get-Date -Format 'yyyyMMdd-HHmmss').sqlite"
Log "[1/6] taking on-demand backup -> $snap"
& sqlite3.exe $DbPath ".backup '$snap'"
if ($LASTEXITCODE -ne 0) { throw "backup failed (exit $LASTEXITCODE)" }
$snapSize = (Get-Item $snap).Length
Log "      backup OK ($snapSize bytes)"

# --- Step 2: capture pre-state ------------------------------------------------
Log "[2/6] capturing pre-state checkpoints"
$preBillCount = & sqlite3.exe $DbPath "SELECT COUNT(*) FROM bills;"
$preLastBill  = & sqlite3.exe $DbPath "SELECT bill_no FROM bills ORDER BY billed_at DESC LIMIT 1;"
Log "      bills=$preBillCount lastBill='$preLastBill'"

# --- Step 3: simulate corruption ---------------------------------------------
$quarantine = "$DbPath.drill-quarantine"
Log "[3/6] quarantining live DB to $quarantine"
Move-Item -Force $DbPath $quarantine

try {
  # --- Step 4: restore from snap --------------------------------------------
  Log "[4/6] restoring from snapshot"
  Copy-Item $snap $DbPath
  $integrity = & sqlite3.exe $DbPath "PRAGMA integrity_check;"
  if ($integrity -ne "ok") { throw "integrity_check returned: $integrity" }
  Log "      integrity_check OK"

  # --- Step 5: validate post-state ------------------------------------------
  Log "[5/6] validating post-state"
  $postBillCount = & sqlite3.exe $DbPath "SELECT COUNT(*) FROM bills;"
  $postLastBill  = & sqlite3.exe $DbPath "SELECT bill_no FROM bills ORDER BY billed_at DESC LIMIT 1;"
  Log "      bills=$postBillCount lastBill='$postLastBill'"
  if ($postBillCount -ne $preBillCount) { throw "bill count mismatch ($preBillCount -> $postBillCount)" }
  if ($postLastBill -ne $preLastBill)   { throw "last bill mismatch ('$preLastBill' -> '$postLastBill')" }

  # --- Step 6: cleanup ------------------------------------------------------
  Log "[6/6] cleanup quarantine"
  Remove-Item $quarantine -Force
  $elapsed = (Get-Date) - $start
  Log "=== DR drill PASSED in $([math]::Round($elapsed.TotalSeconds,1))s ==="
  exit 0
}
catch {
  Log "DRILL FAILED: $_"
  Log "rolling back from quarantine"
  if (Test-Path $quarantine) {
    if (Test-Path $DbPath) { Remove-Item $DbPath -Force }
    Move-Item $quarantine $DbPath
  }
  Log "rollback complete; live DB restored to pre-drill state"
  exit 1
}
