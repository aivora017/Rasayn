#!/usr/bin/env bash
# Runs cargo bench and writes a summary JSON to tests/perf/.
# Used quarterly to populate tests/perf/baseline.json against the §10
# GA-gate budgets. See ADR 0067 (perf harness).

set -euo pipefail
cd "$(dirname "$0")/../.."

GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="tests/perf/results-${GIT_SHA}-${TS}.json"
RAW="/tmp/perf-${TS}.raw"
mkdir -p tests/perf

echo "[perf] running cargo bench (this takes 2-5 min)"
cargo bench \
  --manifest-path apps/desktop/src-tauri/Cargo.toml \
  -- --output-format json \
  > "${RAW}" 2>&1 || true

echo "[perf] writing summary to ${OUT}"
# Real parsing of criterion's JSON would go here; for now, emit a stub
# that points at the raw log so the operator can hand-extract numbers.
HOST=$(hostname)
cat > "${OUT}" <<JSON
{
  "git_sha": "${GIT_SHA}",
  "captured_at": "${TS}",
  "captured_on_machine": "${HOST}",
  "raw_log": "${RAW}",
  "metrics": { "TODO": "parse criterion json output here" }
}
JSON
echo "[done] ${OUT}"
