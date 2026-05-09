#!/usr/bin/env bash
# verify.sh - Verify a snapshot's SHA-256 + sanity-check after restore. S28.A6
# Usage:
#   ./verify.sh <snapshot.tar.zst>           # checksum sidecar match
#   ./verify.sh --post-restore <data_dir>    # PRAGMA integrity_check on live DB
set -euo pipefail

if [[ "${1:-}" == "--post-restore" ]]; then
  DATA_DIR="${2:?usage: verify.sh --post-restore <data_dir>}"
  DB="${DATA_DIR}/pharmacy.sqlite"
  if [[ ! -f "$DB" ]]; then
    echo "[err] no pharmacy.sqlite in $DATA_DIR" >&2
    exit 1
  fi
  RESULT="$(sqlite3 "$DB" 'PRAGMA integrity_check;' 2>&1 || true)"
  if [[ "$RESULT" != "ok" ]]; then
    echo "[err] integrity_check failed: $RESULT" >&2
    exit 2
  fi
  COUNT="$(sqlite3 "$DB" 'SELECT count(*) FROM bills;' 2>/dev/null || echo '?')"
  LATEST="$(sqlite3 "$DB" 'SELECT max(created_at) FROM bills;' 2>/dev/null || echo '?')"
  echo "[ok] integrity_check: ok"
  echo "[ok] bills count: $COUNT"
  echo "[ok] latest bill: $LATEST"
  exit 0
fi

SNAP="${1:?usage: verify.sh <snapshot.tar.zst>}"
SIDECAR="${SNAP}.sha256"

if [[ ! -f "$SNAP" ]]; then
  echo "[err] snapshot not found: $SNAP" >&2
  exit 1
fi
if [[ ! -f "$SIDECAR" ]]; then
  echo "[err] sidecar not found: $SIDECAR" >&2
  exit 2
fi

EXPECTED="$(awk '{print $1}' "$SIDECAR")"
ACTUAL="$(sha256sum "$SNAP" | awk '{print $1}')"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "[err] sha256 mismatch"
  echo "  expected: $EXPECTED"
  echo "  actual:   $ACTUAL"
  exit 3
fi
echo "[ok] sha256 verified: $ACTUAL"
SIZE="$(stat -c%s "$SNAP" 2>/dev/null || stat -f%z "$SNAP")"
echo "[ok] size: $SIZE bytes"
