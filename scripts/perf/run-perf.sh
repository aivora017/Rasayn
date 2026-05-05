#!/usr/bin/env bash
# scripts/perf/run-perf.sh
# PharmaCare Pro perf harness (ADR 0067, Section 10 GA gate).
# Runs cargo bench --bench cold_start --bench bill_save with the
# bencher output format, parses p50/p95, captures host info, and
# emits a JSON results file under tests/perf/results/.

set -euo pipefail

# Resolve repo root (script lives at scripts/perf/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
TS_UTC="$(date -u +%Y%m%d_%H%M%S)"
TS_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

RESULTS_DIR="tests/perf/results"
mkdir -p "${RESULTS_DIR}"
OUT="${RESULTS_DIR}/results-${GIT_SHA}-${TS_UTC}.json"
RAW_FILE="$(mktemp -t perf-bencher.XXXXXX)"

# --- Host info -----------------------------------------------------------
HOST_NAME="$(hostname 2>/dev/null || echo unknown)"
CPU_MODEL="unknown"
if command -v lscpu >/dev/null 2>&1; then
  CPU_MODEL="$(lscpu | awk -F: '/Model name/ {gsub(/^ +/, "", $2); print $2; exit}')"
fi
[ -z "${CPU_MODEL}" ] && CPU_MODEL="unknown"

RAM_MB=0
if [ -r /proc/meminfo ]; then
  RAM_KB="$(awk '/MemTotal/ {print $2; exit}' /proc/meminfo)"
  RAM_MB=$(( RAM_KB / 1024 ))
fi

DISK="unknown"
if command -v lsblk >/dev/null 2>&1; then
  # rota=1 -> spinning HDD, rota=0 -> SSD. Use the root device.
  ROOT_DEV="$(lsblk -ndo pkname "$(findmnt -no SOURCE / 2>/dev/null || echo /dev/null)" 2>/dev/null | head -n1 || true)"
  if [ -n "${ROOT_DEV}" ]; then
    ROTA="$(lsblk -dno ROTA "/dev/${ROOT_DEV}" 2>/dev/null | head -n1 | tr -d ' ')"
    case "${ROTA}" in
      0) DISK="ssd" ;;
      1) DISK="hdd" ;;
      *) DISK="unknown" ;;
    esac
  fi
fi

OS_VER="unknown"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_VER="${PRETTY_NAME:-${NAME:-unknown}}"
fi

# --- Run benches ---------------------------------------------------------
echo "[perf] git_sha=${GIT_SHA} ts=${TS_ISO}"
echo "[perf] host=${HOST_NAME} cpu='${CPU_MODEL}' ram_mb=${RAM_MB} disk=${DISK} os='${OS_VER}'"
echo "[perf] running cargo bench (this takes 5-8 min on i3-8100)"

BENCH_RC=0
(
  cd apps/desktop/src-tauri && \
  cargo bench --bench cold_start --bench bill_save -- --output-format bencher
) > "${RAW_FILE}" 2>&1 || BENCH_RC=$?

RAW_OUTPUT="$(cat "${RAW_FILE}")"

# --- Parse bencher output -----------------------------------------------
# Bencher format lines look like:
#   test cold_start_apply_44_migrations ... bench:    1234567 ns/iter (+/- 56789)
# We treat ns -> ms by dividing by 1_000_000. p50 ~= median; p95 ~= median + 1.96*stddev_proxy.
# Criterion's bencher-shim emits one line per bench. We approximate:
#   p50 = median_ms; p95 = median_ms + (deviation_ms * 1.645)
# (For real distributional p95, see check-baseline.py against criterion's
# native JSON output; this is the best we can do from the bencher shim.)

parse_metric() {
  local pattern="$1"
  python3 - "$pattern" "${RAW_FILE}" <<'PY'
import re, sys
pat = sys.argv[1]
path = sys.argv[2]
median_ms = None
dev_ms = None
samples = 0
rx = re.compile(
    r"test\s+(?P<name>\S+)\s+\.\.\.\s+bench:\s+"
    r"(?P<med>[\d,]+)\s+ns/iter\s+\(\+/-\s+(?P<dev>[\d,]+)\)"
)
with open(path, "r", errors="replace") as f:
    for line in f:
        m = rx.search(line)
        if not m:
            continue
        if pat not in m.group("name"):
            continue
        med = int(m.group("med").replace(",", ""))
        dev = int(m.group("dev").replace(",", ""))
        median_ms = med / 1_000_000.0
        dev_ms = dev / 1_000_000.0
        samples = 100  # criterion default sample size
        break
if median_ms is None:
    print("null null 0")
else:
    p50 = round(median_ms, 3)
    p95 = round(median_ms + (dev_ms * 1.645), 3)
    print(f"{p50} {p95} {samples}")
PY
}

read -r CS_P50 CS_P95 CS_N < <(parse_metric "cold_start" || echo "null null 0")
read -r BS_P50 BS_P95 BS_N < <(parse_metric "bill_save" || echo "null null 0")

# --- Emit JSON -----------------------------------------------------------
python3 - "${OUT}" "${TS_ISO}" "${GIT_SHA}" "${HOST_NAME}" "${CPU_MODEL}" \
  "${RAM_MB}" "${DISK}" "${OS_VER}" "${CS_P50}" "${CS_P95}" "${CS_N}" \
  "${BS_P50}" "${BS_P95}" "${BS_N}" "${BENCH_RC}" <<'PY'
import json, sys

(out, ts, sha, host, cpu, ram, disk, os_ver,
 cs50, cs95, csn, bs50, bs95, bsn, rc) = sys.argv[1:16]

def num(s):
    if s in ("null", "", None):
        return None
    try:
        return float(s)
    except ValueError:
        return None

raw = sys.stdin.read()

doc = {
    "version": 1,
    "captured_at": ts,
    "git_sha": sha,
    "host_info": {
        "hostname": host,
        "cpu": cpu,
        "ram_mb": int(ram) if ram.isdigit() else 0,
        "disk": disk,
        "os": os_ver,
    },
    "metrics": {
        "cold_start_ms": {
            "p50": num(cs50),
            "p95": num(cs95),
            "samples": int(csn) if csn.isdigit() else 0,
        },
        "bill_save_ms": {
            "p50": num(bs50),
            "p95": num(bs95),
            "samples": int(bsn) if bsn.isdigit() else 0,
        },
    },
    "bench_exit_code": int(rc) if rc.lstrip("-").isdigit() else -1,
    "raw_bencher_output": raw,
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2, sort_keys=True)
    f.write("\n")
PY
< "${RAW_FILE}"

rm -f "${RAW_FILE}"
echo "${OUT}"
