#!/usr/bin/env bash
# scripts/pre-push/install-hook.sh
# One-shot installer: points git at the .githooks/ directory and ensures
# the pre-push hook is present + executable.
#
# Idempotent — safe to re-run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "install-hook: not inside a git repo at ${REPO_ROOT}" >&2
  exit 1
fi

# 1. Tell git to use .githooks/ as the hooks directory.
git config core.hooksPath .githooks
echo "install-hook: core.hooksPath = .githooks"

# 2. Make sure the hook file exists. We do NOT overwrite a user-edited
#    hook; only create-on-missing. The wrapper is intentionally trivial
#    (one exec line) so the real logic stays in scripts/pre-push/pcall.sh.
HOOK=".githooks/pre-push"
if [ ! -f "${HOOK}" ]; then
  cat > "${HOOK}" <<'HOOK_BODY'
#!/usr/bin/env bash
# .githooks/pre-push — thin wrapper. Real logic in scripts/pre-push/pcall.sh.
exec "$(git rev-parse --show-toplevel)/scripts/pre-push/pcall.sh" "$@"
HOOK_BODY
  echo "install-hook: wrote ${HOOK}"
else
  echo "install-hook: ${HOOK} already exists — leaving it alone"
fi

chmod +x "${HOOK}" scripts/pre-push/pcall.sh scripts/pre-push/lib.sh
echo "install-hook: chmod +x done"

# 3. Smoke-check: dry-run the validator. Surfaces obvious wiring breakage.
if "${REPO_ROOT}/scripts/pre-push/pcall.sh" --dry-run >/dev/null 2>&1; then
  echo "install-hook: pcall --dry-run OK"
else
  echo "install-hook: pcall --dry-run FAILED — fix before relying on the hook" >&2
  exit 1
fi

cat <<'NEXT'

pcall pre-push hook installed.
  - Skip a gate this push:    PCALL_SKIP=clippy,turbo-test git push
  - Run only one gate:        scripts/pre-push/pcall.sh --gate=cargo-fmt
  - See what would run:       scripts/pre-push/pcall.sh --dry-run
  - Bypass entirely (1x):     git push --no-verify   (do NOT make a habit)
NEXT
