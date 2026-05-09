#!/usr/bin/env bash
# scripts/pre-push/__tests__/test_pcall.sh
# POSIX-shell self-tests for pcall.sh. Runs without bats so it works
# in any sandbox + on a fresh dev rig. To switch to bats later: rename
# to pcall.bats and convert each test_NN() to a `@test "..." { ... }` block.
#
# Each test:
#   1. Sets up a minimal scratch repo (git init + a faux Cargo.toml).
#   2. Runs pcall.sh with the env / args under test.
#   3. Asserts on exit code + log lines + summary JSON.
#
# Run with: bash scripts/pre-push/__tests__/test_pcall.sh

set -uo pipefail   # NOT -e — we want to capture failures locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PCALL_SH="${PCALL_DIR}/pcall.sh"

PASS=0
FAIL=0
TESTS=()

# --- assert helpers ------------------------------------------------------
expect_eq() {
  local got="$1" want="$2" label="$3"
  if [ "${got}" = "${want}" ]; then
    printf '  [ok]   %s\n' "${label}"
    PASS=$((PASS+1))
  else
    printf '  [FAIL] %s\n' "${label}"
    printf '         got:  %q\n' "${got}"
    printf '         want: %q\n' "${want}"
    FAIL=$((FAIL+1))
  fi
}

expect_grep() {
  local file="$1" pattern="$2" label="$3"
  if grep -qE "${pattern}" "${file}"; then
    printf '  [ok]   %s\n' "${label}"
    PASS=$((PASS+1))
  else
    printf '  [FAIL] %s\n' "${label}"
    printf '         pattern not found: %s\n' "${pattern}"
    printf '         file: %s\n' "${file}"
    sed -n '1,40p' "${file}" | sed 's/^/           | /'
    FAIL=$((FAIL+1))
  fi
}

# --- scratch-repo factory ------------------------------------------------
make_scratch_repo() {
  # Args: $1 = "good"|"bad-toml"|"bad-fmt"
  local kind="$1"
  local d
  d="$(mktemp -d -t pcall-test.XXXXXX)"
  (
    cd "${d}"
    git init -q
    git config user.email t@t
    git config user.name t
    mkdir -p apps/desktop/src-tauri/src
    case "${kind}" in
      good)
        cat > apps/desktop/src-tauri/Cargo.toml <<'TOML'
[package]
name = "pharmacare-app"
version = "0.0.0"
edition = "2021"

[dependencies]
TOML
        printf 'fn main() {}\n' > apps/desktop/src-tauri/src/main.rs
        ;;
      bad-toml)
        # Mimic the S27 mojibake: a comment-wrap that lost its leading #.
        cat > apps/desktop/src-tauri/Cargo.toml <<'TOML'
[package]
name = "pharmacare-app"
version = "0.0.0"
edition = "2021"
# Build via:
es. Build via: cargo build --features cygnet-live
TOML
        ;;
      bad-fmt)
        cat > apps/desktop/src-tauri/Cargo.toml <<'TOML'
[package]
name = "pharmacare-app"
version = "0.0.0"
edition = "2021"
TOML
        # Intentionally rustfmt-noncompliant: bad indent + trailing space
        printf 'fn main() {   \n   let x=1;   \nx;\n}\n' \
          > apps/desktop/src-tauri/src/main.rs
        ;;
    esac
    cat > package.json <<'JSON'
{ "name": "pharmacare-test", "private": true,
  "scripts": { "typecheck": "echo tsc-ok", "test": "echo test-ok" } }
JSON
    git add -A >/dev/null
    git commit -q -m "init"
  )
  printf '%s\n' "${d}"
}

# --- test 1: all-skip-mode runs clean -----------------------------------
test_all_skip_mode() {
  printf '\n[test_all_skip_mode]\n'
  local repo log summary
  repo="$(make_scratch_repo good)"
  log="$(mktemp)"
  summary="${repo}/pcall-summary.json"

  (
    cd "${repo}"
    NO_COLOR=1 \
      PCALL_SKIP=cargo-metadata,cargo-fmt,clippy,tsc,turbo-test,graph-lint \
      PCALL_SUMMARY="${summary}" \
      bash "${PCALL_SH}"
  ) > "${log}" 2>&1
  local rc=$?

  expect_eq "${rc}" "0" "exit=0 in all-skip mode"
  expect_grep "${log}" 'gate=cargo-metadata status=SKIP' 'cargo-metadata SKIP logged'
  expect_grep "${log}" 'gate=graph-lint status=SKIP' 'graph-lint SKIP logged'
  expect_grep "${summary}" '"schema": "pcall-summary/v1"' 'summary JSON written'
  expect_grep "${summary}" '"name": "cargo-metadata"' 'summary contains cargo-metadata'
  TESTS+=("test_all_skip_mode")
}

# --- test 2: cargo-metadata gate fails the chain ------------------------
# We can't actually invoke cargo in the sandbox, so simulate by injecting
# a fake `cargo` on PATH that exits 1 for `metadata`. This proves the
# gate dispatcher honors a non-zero return as FAIL and short-circuits.
test_cargo_metadata_fail() {
  printf '\n[test_cargo_metadata_fail]\n'
  local repo log summary fakebin
  repo="$(make_scratch_repo bad-toml)"
  log="$(mktemp)"
  fakebin="$(mktemp -d -t pcall-fakebin.XXXXXX)"
  summary="${repo}/pcall-summary.json"

  cat > "${fakebin}/cargo" <<'CARGO'
#!/usr/bin/env bash
case "$1" in
  metadata) echo "error: key with no value, expected '='" >&2; exit 1 ;;
  fmt|clippy) echo "should-not-run-after-metadata-fail" >&2; exit 1 ;;
  *) echo "unknown cargo cmd: $*" >&2; exit 2 ;;
esac
CARGO
  chmod +x "${fakebin}/cargo"

  (
    cd "${repo}"
    PATH="${fakebin}:${PATH}" \
      NO_COLOR=1 \
      PCALL_SKIP=tsc,turbo-test,graph-lint \
      PCALL_SUMMARY="${summary}" \
      bash "${PCALL_SH}"
  ) > "${log}" 2>&1
  local rc=$?

  expect_eq "${rc}" "1" "exit=1 when cargo-metadata fails"
  expect_grep "${log}" 'gate=cargo-metadata status=FAIL' 'cargo-metadata FAIL logged'
  expect_grep "${log}" 'fail-fast: aborting at gate=cargo-metadata' 'fail-fast log line'
  # cargo-fmt should NOT have started (fail-fast aborts the chain)
  if grep -q 'gate=cargo-fmt status=START' "${log}"; then
    printf '  [FAIL] cargo-fmt started after metadata-FAIL (should fail-fast)\n'
    FAIL=$((FAIL+1))
  else
    printf '  [ok]   chain short-circuited at cargo-metadata\n'
    PASS=$((PASS+1))
  fi
  TESTS+=("test_cargo_metadata_fail")
}

# --- test 3: cargo-fmt fail blocks the push -----------------------------
test_cargo_fmt_fail() {
  printf '\n[test_cargo_fmt_fail]\n'
  local repo log summary fakebin
  repo="$(make_scratch_repo bad-fmt)"
  log="$(mktemp)"
  fakebin="$(mktemp -d -t pcall-fakebin.XXXXXX)"
  summary="${repo}/pcall-summary.json"

  # cargo metadata passes, cargo fmt --check fails (mimics CI's first hard gate).
  cat > "${fakebin}/cargo" <<'CARGO'
#!/usr/bin/env bash
case "$1" in
  metadata) exit 0 ;;
  fmt)      echo "Diff in /repo/main.rs at line 1" >&2; exit 1 ;;
  *)        exit 2 ;;
esac
CARGO
  chmod +x "${fakebin}/cargo"

  (
    cd "${repo}"
    PATH="${fakebin}:${PATH}" \
      NO_COLOR=1 \
      PCALL_SKIP=clippy,tsc,turbo-test,graph-lint \
      PCALL_SUMMARY="${summary}" \
      bash "${PCALL_SH}"
  ) > "${log}" 2>&1
  local rc=$?

  expect_eq "${rc}" "1" "exit=1 when cargo-fmt fails"
  expect_grep "${log}" 'gate=cargo-metadata status=PASS' 'cargo-metadata PASS first'
  expect_grep "${log}" 'gate=cargo-fmt status=FAIL' 'cargo-fmt FAIL logged'
  TESTS+=("test_cargo_fmt_fail")
}

# --- test 4: --gate=tsc isolates tsc ------------------------------------
test_single_gate_tsc() {
  printf '\n[test_single_gate_tsc]\n'
  local repo log summary
  repo="$(make_scratch_repo good)"
  log="$(mktemp)"
  summary="${repo}/pcall-summary.json"

  (
    cd "${repo}"
    NO_COLOR=1 \
      PCALL_SUMMARY="${summary}" \
      bash "${PCALL_SH}" --gate=tsc --dry-run
  ) > "${log}" 2>&1
  local rc=$?

  expect_eq "${rc}" "0" "exit=0 for --gate=tsc --dry-run"
  expect_grep "${log}" '^  - tsc$' 'tsc would run'
  expect_grep "${log}" 'cargo-metadata.*single-gate=tsc' 'cargo-metadata skipped (single-gate=tsc)'
  expect_grep "${log}" 'turbo-test.*single-gate=tsc' 'turbo-test skipped (single-gate=tsc)'
  TESTS+=("test_single_gate_tsc")
}

# --- runner --------------------------------------------------------------
echo "pcall self-tests starting"
echo "  PCALL_SH = ${PCALL_SH}"

test_all_skip_mode
test_cargo_metadata_fail
test_cargo_fmt_fail
test_single_gate_tsc

echo
printf 'pcall self-tests: %d passed, %d failed (%d cases)\n' \
  "${PASS}" "${FAIL}" "${#TESTS[@]}"
if [ "${FAIL}" -gt 0 ]; then exit 1; fi
exit 0
