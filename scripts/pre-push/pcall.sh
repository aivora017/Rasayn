#!/usr/bin/env bash
# scripts/pre-push/pcall.sh
# PharmaCare Pro pre-push validator (bash port).
#
# Purpose
#   Run the canonical local-validation gate-chain BEFORE any push or PR.
#   Gates are ordered cheapest-first so a Cargo.toml mojibake bug (the
#   actual failure mode at S27 land — see WORKING_PATTERNS sec 14) trips
#   in <500 ms instead of after a 60-second turbo run.
#
# Gate chain (default, in order)
#   1. cargo-metadata    — manifest parse (cheapest fail; canonical for
#                          "is the Cargo.toml structurally valid")
#   2. cargo-fmt         — formatting check (CI's first hard gate)
#   3. clippy            — opt-in via PCALL_CLIPPY=1 or --gate=clippy
#                          (deny-warnings; off by default to keep pre-push
#                          fast on dev rigs)
#   4. tsc               — turbo run typecheck (fans across all packages)
#   5. turbo-test        — turbo run test (changed packages only when
#                          possible, full when not)
#   6. graph-lint        — SYSTEM_GRAPH consistency (skipped with WARN if
#                          no `graph-lint` script exists yet)
#
# Flags
#   --dry-run            — list gates that WOULD run, do nothing.
#   --gate=<name>        — run ONE gate only. Useful for debugging a
#                          single failure: `pcall.sh --gate=cargo-fmt`.
#   --gate=help          — print help and exit 0.
#   -h | --help          — alias for --gate=help.
#
# Env vars
#   PCALL_SKIP=a,b,c     — skip these gates by name (comma-separated).
#   PCALL_CLIPPY=1       — opt clippy IN even outside --gate.
#   PCALL_SUMMARY=path   — override summary-json path. Default:
#                          <repo-root>/pcall-summary.json.
#   NO_COLOR=1           — disable ANSI colors.
#
# Exit codes
#   0   all gates PASS or SKIP/WARN
#   1   at least one gate FAIL
#   2   bad usage
#
# Hazards (per WORKING_PATTERNS)
#   sec 13: NEVER push if any gate fails.
#   sec 14: cargo-metadata MUST run BEFORE cargo-fmt (a corrupt manifest
#           crashes fmt with a misleading "unclosed delimiter" error).
#   sec 15: bash-first. PowerShell parity is a Windows-only fallback.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

REPO_ROOT="$(pc_repo_root)"
cd "${REPO_ROOT}"

# --- arg parse -----------------------------------------------------------
PCALL_DRY_RUN=0
PCALL_SINGLE_GATE=""
export PCALL_SINGLE_GATE

print_help() {
  cat <<'HELP'
pcall.sh — PharmaCare Pro pre-push validator (bash port)

Usage:
  scripts/pre-push/pcall.sh [--dry-run] [--gate=<name>]

Flags:
  --dry-run         List gates that would run, do nothing.
  --gate=<name>     Run ONLY this gate. <name> is one of:
                      cargo-metadata, cargo-fmt, clippy,
                      tsc, turbo-test, graph-lint, help
  -h, --help        Show this help.

Env:
  PCALL_SKIP=a,b    Skip gates a and b (comma-separated).
  PCALL_CLIPPY=1    Run clippy even in default chain (off by default).
  PCALL_SUMMARY=p   Override summary-json output path.
  NO_COLOR=1        Disable ANSI colors.

Exit:
  0 ok    1 fail    2 bad usage

Order matters — see WORKING_PATTERNS sec 14: cargo-metadata MUST run
before cargo-fmt because fmt cannot parse a malformed manifest.
HELP
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      PCALL_DRY_RUN=1
      shift
      ;;
    --gate=help|-h|--help)
      print_help
      exit 0
      ;;
    --gate=*)
      PCALL_SINGLE_GATE="${1#--gate=}"
      shift
      ;;
    *)
      printf 'pcall: unknown arg: %s\n' "$1" >&2
      print_help >&2
      exit 2
      ;;
  esac
done

# --- gate definitions ----------------------------------------------------
# Each gate function returns 0 on PASS, non-zero on FAIL, 77 on SKIP-with-
# reason (the runner uses PCALL_LAST_REASON to surface why), 78 on WARN.

CARGO_MANIFEST="apps/desktop/src-tauri/Cargo.toml"

gate_cargo_metadata() {
  if ! command -v cargo >/dev/null 2>&1; then
    PCALL_LAST_REASON="cargo-not-on-PATH"
    return 77
  fi
  if [ ! -f "${CARGO_MANIFEST}" ]; then
    PCALL_LAST_REASON="manifest-not-found:${CARGO_MANIFEST}"
    return 77
  fi
  cargo metadata --no-deps --manifest-path "${CARGO_MANIFEST}" -q >/dev/null
}

gate_cargo_fmt() {
  if ! command -v cargo >/dev/null 2>&1; then
    PCALL_LAST_REASON="cargo-not-on-PATH"
    return 77
  fi
  if [ ! -f "${CARGO_MANIFEST}" ]; then
    PCALL_LAST_REASON="manifest-not-found"
    return 77
  fi
  cargo fmt --manifest-path "${CARGO_MANIFEST}" -- --check
}

gate_clippy() {
  if ! command -v cargo >/dev/null 2>&1; then
    PCALL_LAST_REASON="cargo-not-on-PATH"
    return 77
  fi
  # Opt-in only: in default chain, skip unless PCALL_CLIPPY=1 OR single-gate.
  if [ -z "${PCALL_SINGLE_GATE:-}" ] && [ "${PCALL_CLIPPY:-0}" != "1" ]; then
    PCALL_LAST_REASON="opt-in-only-set-PCALL_CLIPPY=1"
    return 77
  fi
  cargo clippy --no-deps --manifest-path "${CARGO_MANIFEST}" -- -D warnings
}

# Pick a JS package manager: pnpm if present, else npm. Documented in README.
pc_pkg_mgr() {
  if command -v pnpm >/dev/null 2>&1; then
    printf 'pnpm\n'
  elif command -v npm >/dev/null 2>&1; then
    printf 'npm\n'
  else
    printf '\n'
  fi
}

gate_tsc() {
  local pm
  pm="$(pc_pkg_mgr)"
  if [ -z "${pm}" ]; then
    PCALL_LAST_REASON="no-pnpm-no-npm"
    return 77
  fi
  case "${pm}" in
    pnpm) pnpm -s typecheck ;;
    npm)  npm run -s typecheck ;;
  esac
}

gate_turbo_test() {
  local pm
  pm="$(pc_pkg_mgr)"
  if [ -z "${pm}" ]; then
    PCALL_LAST_REASON="no-pnpm-no-npm"
    return 77
  fi
  # Try changed-package filter first; fall back to full if HEAD^1 isn't
  # available (shallow clone, brand-new branch with one commit, etc).
  local filter='--filter=...[HEAD^1]'
  if ! git rev-parse --verify HEAD^1 >/dev/null 2>&1; then
    filter=''
  fi
  case "${pm}" in
    pnpm) pnpm -s exec turbo run test ${filter} ;;
    npm)  npx --yes turbo run test ${filter} ;;
  esac
}

gate_graph_lint() {
  if [ ! -f docs/architecture/system_graph.json ]; then
    PCALL_LAST_REASON="no-system_graph.json"
    return 78
  fi
  local pm
  pm="$(pc_pkg_mgr)"
  if [ -z "${pm}" ]; then
    PCALL_LAST_REASON="no-pkg-mgr"
    return 78
  fi
  if ! grep -q '"graph-lint"' package.json 2>/dev/null; then
    PCALL_LAST_REASON="no-graph-lint-script-in-package.json"
    return 78
  fi
  case "${pm}" in
    pnpm) pnpm -s graph-lint ;;
    npm)  npm run -s graph-lint ;;
  esac
}

# --- gate registry (ordered) ---------------------------------------------
PCALL_GATES=(
  "cargo-metadata"
  "cargo-fmt"
  "clippy"
  "tsc"
  "turbo-test"
  "graph-lint"
)

pc_dispatch_gate() {
  local g="$1"
  case "${g}" in
    cargo-metadata) pc_run_gate "${g}" gate_cargo_metadata ;;
    cargo-fmt)      pc_run_gate "${g}" gate_cargo_fmt ;;
    clippy)         pc_run_gate "${g}" gate_clippy ;;
    tsc)            pc_run_gate "${g}" gate_tsc ;;
    turbo-test)     pc_run_gate "${g}" gate_turbo_test ;;
    graph-lint)     pc_run_gate "${g}" gate_graph_lint ;;
    *)
      printf 'pcall: unknown gate: %s\n' "${g}" >&2
      return 2
      ;;
  esac
}

# --- dry-run path --------------------------------------------------------
if [ "${PCALL_DRY_RUN}" = "1" ]; then
  pc_log_info "dry-run: gate plan"
  for g in "${PCALL_GATES[@]}"; do
    if [ -n "${PCALL_SINGLE_GATE}" ] && [ "${PCALL_SINGLE_GATE}" != "${g}" ]; then
      printf '  - %s (skip: single-gate=%s)\n' "${g}" "${PCALL_SINGLE_GATE}"
      continue
    fi
    if pc_is_skipped "${g}"; then
      printf '  - %s (skip: PCALL_SKIP)\n' "${g}"
      continue
    fi
    printf '  - %s\n' "${g}"
  done
  exit 0
fi

# --- validate single-gate name -------------------------------------------
if [ -n "${PCALL_SINGLE_GATE}" ]; then
  match=0
  for g in "${PCALL_GATES[@]}"; do
    [ "${g}" = "${PCALL_SINGLE_GATE}" ] && match=1
  done
  if [ "${match}" -eq 0 ]; then
    printf 'pcall: unknown gate: %s (try --gate=help)\n' "${PCALL_SINGLE_GATE}" >&2
    exit 2
  fi
fi

# --- run the chain -------------------------------------------------------
SUMMARY_PATH="${PCALL_SUMMARY:-${REPO_ROOT}/pcall-summary.json}"
overall_rc=0

for g in "${PCALL_GATES[@]}"; do
  if ! pc_dispatch_gate "${g}"; then
    overall_rc=1
    pc_log_info "fail-fast: aborting at gate=${g}"
    break
  fi
done

# Always emit summary, even on failure — it's the post-mortem artifact.
pc_write_summary_json "${SUMMARY_PATH}"
pc_log_info "summary written to ${SUMMARY_PATH}"

exit "${overall_rc}"
