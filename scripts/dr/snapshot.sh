#!/usr/bin/env bash
# snapshot.sh - DR snapshot driver (Linux/WSL flavor) - S28.A6
# Produces: pharmacare-snapshot-YYYY-MM-DD-HHmm-{shop_id}.tar.zst
#           plus a .sha256 sidecar
# Includes:  pharmacy.sqlite + uploads/ + crypto/keyring/ + .env config
# Excludes:  logs/, target/, node_modules/, .git/
# ENV VARS:
#   PHARMACARE_BACKUP_DIR  -- destination root (Q-014 default external SSD)
#   PHARMACARE_DATA_DIR    -- source data root (default ~/.local/share/PharmaCarePro)
#   PHARMACARE_SHOP_ID     -- shop slug for the filename (default 'unknown')
# Usage:
#   ./snapshot.sh [--dry-run]
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

DATA_DIR="${PHARMACARE_DATA_DIR:-$HOME/.local/share/PharmaCarePro}"
BACKUP_DIR="${PHARMACARE_BACKUP_DIR:-/mnt/ssd/pharmacare-backups}"
SHOP_ID="${PHARMACARE_SHOP_ID:-unknown}"
TS="$(date -u +%Y-%m-%d-%H%M)"
NAME="pharmacare-snapshot-${TS}-${SHOP_ID}.tar.zst"
OUT="${BACKUP_DIR}/${NAME}"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "[err] data dir not found: $DATA_DIR" >&2
  exit 1
fi

if (( DRY_RUN )); then
  echo "[dry-run] would tar.zst $DATA_DIR -> $OUT"
  echo "[dry-run] excludes: logs/ target/ node_modules/ .git/"
  exit 0
fi

mkdir -p "$BACKUP_DIR"

if command -v zstd >/dev/null 2>&1; then
  tar --exclude='logs' --exclude='target' --exclude='node_modules' --exclude='.git' \
      -C "$DATA_DIR" -cf - . | zstd -19 -o "$OUT"
else
  echo "[warn] zstd not found; falling back to .tar.gz" >&2
  OUT="${BACKUP_DIR}/${NAME%.tar.zst}.tar.gz"
  tar --exclude='logs' --exclude='target' --exclude='node_modules' --exclude='.git' \
      -C "$DATA_DIR" -czf "$OUT" .
fi

SHA="$(sha256sum "$OUT" | awk '{print $1}')"
printf '%s  %s\n' "$SHA" "$(basename "$OUT")" > "${OUT}.sha256"
echo "[ok] $OUT"
echo "[ok] sha256=$SHA"
