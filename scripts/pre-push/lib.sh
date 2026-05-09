#!/usr/bin/env bash
# scripts/pre-push/lib.sh
# Shared logging, color, timing helpers for pcall.sh.
# Sourced — do NOT execute. set -euo pipefail is the caller's job.
# ASCII-only by design; runs under bash 4.x+ on Linux/macOS/WSL2/Cowork sandbox.

# Avoid double-sourcing — guard with a sentinel.
if [ -n "${__PCALL_LIB_SOURCED:-}" ]; then
  return 0 2>/dev/null || true
fi
__PCALL_LIB_SOURCED=1

# --- color (NO_COLOR aware; off when not a tty) --------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  PC_RED='\033[0;31m'
  PC_GRN='\033[0;32m'
  PC_YLW='\033[0;33m'
  PC_BLU='\033[0;34m'
  PC_DIM='\033[2m'
  PC_RST='\033[0m'
else
  PC_RED=''
  PC_GRN=''
  PC_YLW=''
  PC_BLU=''
  PC_DIM=''
  PC_RST=''
fi

# --- monotonic millisecond timer -----------------------------------------
# Bash 5 has $EPOCHREALTIME (seconds.microseconds). Older bash: fall back
# to date +%s%3N. Both are wall-clock; OK for our coarse gate timing.
pc_now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    # 1715000000.123456 -> 1715000000123 (drop the .)
    local er="${EPOCHREALTIME}"
    local sec="${er%.*}"
    local us="${er#*.}"
    # take first 3 chars of microseconds for ms; pad if shorter
    us="${us:0:3}"
    while [ "${#us}" -lt 3 ]; do us="${us}0"; done
    printf '%s%s\n' "${sec}" "${us}"
  else
    date +%s%3N 2>/dev/null || echo 0
  fi
}

# --- log helpers (grep-friendly, machine-parseable) ----------------------
pc_log_start() {
  # $1 = gate name
  printf '%b[PCALL gate=%s status=START]%b\n' "${PC_BLU}" "$1" "${PC_RST}"
}

pc_log_pass() {
  # $1 = gate name, $2 = elapsed ms
  printf '%b[PCALL gate=%s status=PASS elapsed=%sms]%b\n' "${PC_GRN}" "$1" "$2" "${PC_RST}"
}

pc_log_fail() {
  # $1 = gate name, $2 = elapsed ms
  printf '%b[PCALL gate=%s status=FAIL elapsed=%sms]%b\n' "${PC_RED}" "$1" "$2" "${PC_RST}" >&2
}

pc_log_skip() {
  # $1 = gate name, $2 = reason
  printf '%b[PCALL gate=%s status=SKIP reason=%s]%b\n' "${PC_YLW}" "$1" "$2" "${PC_RST}"
}

pc_log_warn() {
  # $1 = gate name, $2 = reason
  printf '%b[PCALL gate=%s status=WARN reason=%s]%b\n' "${PC_YLW}" "$1" "$2" "${PC_RST}" >&2
}

pc_log_info() {
  printf '%b[PCALL] %s%b\n' "${PC_DIM}" "$*" "${PC_RST}"
}

# --- skip-list helper ----------------------------------------------------
# PCALL_SKIP is a comma-separated list of gate names (e.g. clippy,turbo-test).
pc_is_skipped() {
  local gate="$1"
  local list="${PCALL_SKIP:-}"
  [ -z "${list}" ] && return 1
  case ",${list}," in
    *,"${gate}",*) return 0 ;;
  esac
  return 1
}

# --- gate runner ---------------------------------------------------------
# Usage: pc_run_gate <gate> <fn>
# fn returns 0 on PASS, non-zero on FAIL, 77 on SKIP-with-reason, 78 on WARN.
# Records timing + status into PCALL_GATE_LOG (parallel arrays).
PCALL_GATE_LOG_NAME=()
PCALL_GATE_LOG_STATUS=()
PCALL_GATE_LOG_MS=()
PCALL_GATE_LOG_REASON=()

pc_record() {
  PCALL_GATE_LOG_NAME+=("$1")
  PCALL_GATE_LOG_STATUS+=("$2")
  PCALL_GATE_LOG_MS+=("$3")
  PCALL_GATE_LOG_REASON+=("${4:-}")
}

pc_run_gate() {
  local gate="$1"
  local fn="$2"
  local single="${PCALL_SINGLE_GATE:-}"

  if [ -n "${single}" ] && [ "${single}" != "${gate}" ]; then
    pc_record "${gate}" "SKIP" "0" "single-gate-mode"
    return 0
  fi

  if pc_is_skipped "${gate}"; then
    pc_log_skip "${gate}" "PCALL_SKIP"
    pc_record "${gate}" "SKIP" "0" "PCALL_SKIP"
    return 0
  fi

  pc_log_start "${gate}"
  local t0 t1 dt rc
  t0="$(pc_now_ms)"
  set +e
  "${fn}"
  rc=$?
  set -e
  t1="$(pc_now_ms)"
  dt=$(( t1 - t0 ))
  case "${rc}" in
    0)
      pc_log_pass "${gate}" "${dt}"
      pc_record "${gate}" "PASS" "${dt}" ""
      return 0
      ;;
    77)
      pc_log_skip "${gate}" "${PCALL_LAST_REASON:-skip}"
      pc_record "${gate}" "SKIP" "${dt}" "${PCALL_LAST_REASON:-skip}"
      return 0
      ;;
    78)
      pc_log_warn "${gate}" "${PCALL_LAST_REASON:-warn}"
      pc_record "${gate}" "WARN" "${dt}" "${PCALL_LAST_REASON:-warn}"
      return 0
      ;;
    *)
      pc_log_fail "${gate}" "${dt}"
      pc_record "${gate}" "FAIL" "${dt}" "exit=${rc}"
      return "${rc}"
      ;;
  esac
}

# --- atomic JSON summary writer ------------------------------------------
# Atomic = write to tmpfile + rename. Safe under concurrent runs because
# rename(2) is atomic on the same filesystem. We do NOT depend on jq; we
# emit valid JSON by hand from the parallel arrays.
pc_write_summary_json() {
  local out="$1"
  local tmp
  tmp="$(mktemp "${out}.XXXXXX")" || { echo "pcall: mktemp failed" >&2; return 1; }
  {
    printf '{\n'
    printf '  "schema": "pcall-summary/v1",\n'
    printf '  "ts_iso": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "gates": [\n'
    local i n
    n="${#PCALL_GATE_LOG_NAME[@]}"
    for (( i=0; i<n; i++ )); do
      local sep=','
      [ $((i+1)) -eq "${n}" ] && sep=''
      # JSON-escape the reason (only needs " and \\ handling for our use).
      local reason="${PCALL_GATE_LOG_REASON[$i]}"
      reason="${reason//\\/\\\\}"
      reason="${reason//\"/\\\"}"
      printf '    {"name": "%s", "status": "%s", "elapsed_ms": %s, "reason": "%s"}%s\n' \
        "${PCALL_GATE_LOG_NAME[$i]}" \
        "${PCALL_GATE_LOG_STATUS[$i]}" \
        "${PCALL_GATE_LOG_MS[$i]}" \
        "${reason}" \
        "${sep}"
    done
    printf '  ]\n'
    printf '}\n'
  } > "${tmp}"
  mv -f "${tmp}" "${out}"
}

# --- repo-root resolver --------------------------------------------------
# git rev-parse --show-toplevel is the source of truth. If we're not in a
# repo (rare — sandbox testing), fall back to the script's grandparent.
pc_repo_root() {
  local r
  if r="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "${r}"
  else
    # scripts/pre-push/lib.sh -> ../..
    local s
    s="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    printf '%s\n' "$(cd "${s}/../.." && pwd)"
  fi
}
