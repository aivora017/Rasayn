#!/usr/bin/env bash
# restore-license-store.sh — pull licenses.jsonl back from S3 to the
# storefront host. Used during DR drill (docs/runbooks/dr-drill.md).
#
# Usage: ./restore-license-store.sh <s3-uri> <local-target>
# Example: ./restore-license-store.sh s3://pharmacare-prod-backups/licenses.jsonl ./licenses.jsonl

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <s3-uri> <local-target>"
  exit 1
fi

S3_URI="$1"
TARGET="$2"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -f "$TARGET" ]]; then
  echo "[step] Preserving existing target as ${TARGET}.before-restore-${TIMESTAMP}"
  mv "$TARGET" "${TARGET}.before-restore-${TIMESTAMP}"
fi

echo "[step] Pulling $S3_URI"
aws s3 cp "$S3_URI" "$TARGET"

echo "[step] Quick sanity check — count records, verify newest line is valid JSON"
COUNT=$(wc -l < "$TARGET")
LAST=$(tail -n 1 "$TARGET")
echo "  $COUNT records, last line:"
echo "  $LAST" | jq . > /dev/null
echo "[ok] Last record is well-formed JSON."

echo "[done] License store restored. Run a curl smoke test:"
echo "  curl -s 'https://storefront.example.com/api/license/lookup?key=KEY&email=EMAIL' | jq ."
