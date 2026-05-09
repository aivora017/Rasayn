#!/usr/bin/env bash
# restore.sh - DR restore driver (Linux/WSL flavor) - S28.A6
# Steps:
#   1. Stop the desktop app (caller does this; see runbook).
#   2. Verify SHA-256 against sidecar.
#   3. Untar to a staging dir.
#   4. Atomic swap into the live data dir.
#   5. Run PRAGMA integrity_check on the restored DB.
# ENV VARS:
#   PHARMACARE_DATA_DIR    -- live data root (default ~/.local/share/PharmaCarePro)
# Usage:
#   ./restore.sh <snapshot.tar.zst> [--dry-run]
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <snapshot.tar.zst> [--dry-run]" >&2
  exit 64
fi

SNAP="$1"
DRY_RUN=0
if [[ "${2:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

DATA_DIR="${PHARMACARE_DATA_DIR:-$HOME/.local/share/PharmaCarePro}"
SIDECAR="${SNAP}.sha256"

if [[ ! -f "$SNAP" ]]; then
  echo "[err] snapshot not found: $SNAP" >&2
  exit 1
fi

if [[ -f "$SIDECAR" ]]; then
  EXPECTED="$(awk '{print $1}' "$SIDECAR")"
  ACTUAL="$(sha256sum "$SNAP" | awk '{print $1}')"
  if [[ "$EXPECTED" != "$ACTUAL" ]]; then
    echo "[err] sha256 mismatch: expected $EXPECTED got $ACTUAL" >&2
    exit 2
  fi
  echo "[ok] sha256 verified"
else
  echo "[warn] no sidecar found at $SIDECAR -- proceeding without verification"
fi

STAGE="$(mktemp -d)"
echo "[step] staging into $STAGE"
if [[ "$SNAP" == *.tar.zst ]]; then
  zstd -d -c "$SNAP" | tar -xf - -C "$STAGE"
elif [[ "$SNAP" == *.tar.gz ]]; then
  tar -xzf "$SNAP" -C "$STAGE"
else
  echo "[err] unknown snapshot format: $SNAP" >&2
  exit 3
fi

if (( DRY_RUN )); then
  echo "[dry-run] would swap $STAGE -> $DATA_DIR"
  exit 0
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
PRESERVE="${DATA_DIR}.before-restore-${TS}"
if [[ -d "$DATA_DIR" ]]; then
  mv "$DATA_DIR" "$PRESERVE"
  echo "[step] preserved old as $PRESERVE"
fi
mv "$STAGE" "$DATA_DIR"

DB="${DATA_DIR}/pharmacy.sqlite"
if [[ -f "$DB" ]]; then
  RESULT="$(sqlite3 "$DB" 'PRAGMA integrity_check;' 2>&1 || true)"
  if [[ "$RESULT" != "ok" ]]; then
    echo "[err] integrity_check failed: $RESULT" >&2
    exit 4
  fi
  echo "[ok] integrity_check: ok"
fi
echo "[done] restored. pre-restore copy at $PRESERVE"
