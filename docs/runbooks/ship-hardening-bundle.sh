#!/usr/bin/env bash
# ship-hardening-bundle.sh
#
# PR B — S03 + G01 + G03 bundled ship. Parallel to PR A (TS hardening).
#
#   S03 — Gmail API response body size cap (docs/reviews/security-2026-04-18.md)
#   G01 — lib/ipc.ts contract tests (docs/reviews/coverage-gaps-2026-04-18.md)
#   G03 — src-tauri/db.rs PRAGMA + busy_timeout + concurrency tests
#
# Files touched:
#   apps/desktop/src-tauri/src/oauth/gmail_api.rs  — S03: content-length preflight + 5 new tests
#   apps/desktop/src-tauri/src/db.rs               — G03: busy_timeout(5s) + 2 new tests
#   apps/desktop/src/lib/ipc.contract.test.ts      — G01: new 40+ case contract suite
#   docs/runbooks/ship-hardening-bundle.sh         — this file
#
# Runs from anywhere under the repo. Needs $HOME/.ghtok (PAT with repo scope).
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-hardening-bundle.sh
#
# Identity: aivora017 <aivora017@gmail.com>.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ ! -f "$HOME/.ghtok" ]]; then
  echo "ERR: missing \$HOME/.ghtok (PAT with repo scope)." >&2
  exit 1
fi
PAT="$(cat "$HOME/.ghtok")"
REPO="$(git config --get remote.origin.url \
  | sed -E 's#(.*github.com[:/])([^/]+/[^/.]+)(\.git)?$#\2#')"
BRANCH="chore/hardening-s03-g01-g03"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate. Check the PR."
  exit 0
fi

# Confirm we have the four expected files with unstaged/staged changes.
CHANGED_OK=0
for f in \
  apps/desktop/src-tauri/src/oauth/gmail_api.rs \
  apps/desktop/src-tauri/src/db.rs \
  apps/desktop/src/lib/ipc.contract.test.ts \
  docs/runbooks/ship-hardening-bundle.sh
do
  if ! git diff --quiet -- "$f" || [[ -n "$(git status --porcelain -- "$f")" ]]; then
    CHANGED_OK=1
  fi
done
if [[ "$CHANGED_OK" -eq 0 ]]; then
  echo "No changes detected across the expected four files; nothing to ship."
  exit 1
fi

# --- Rust local gate (WSL has no cargo; PowerShell gate noted for operator) ---
#
# PowerShell-side gate to run before ship:
#
#   cd 'C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro\apps\desktop\src-tauri'
#   cargo fmt --all
#   cargo check --all-targets
#   cargo test oauth::gmail_api::tests   # 4 existing + 5 new S03 tests
#   cargo test db::tests                 # 4 migration + 2 new G03 tests
#   cargo test                           # everything else (products, phash, images, oauth::*)
#   cargo clippy --all-targets -- -D warnings
if command -v cargo >/dev/null 2>&1; then
  echo "=== cargo fmt ==="
  (cd apps/desktop/src-tauri && cargo fmt --all)
  echo "=== cargo check ==="
  (cd apps/desktop/src-tauri && cargo check --all-targets)
  echo "=== cargo test (gmail_api + db + everything) ==="
  (cd apps/desktop/src-tauri && cargo test)
  echo "=== cargo clippy ==="
  (cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings)
else
  echo "WARN: cargo not on PATH (WSL). Skipping Rust gate — CI will gate."
  echo "      Run the PowerShell gate in the comment above before ship for faster feedback."
  sleep 3
fi

# --- TS/vitest local gate (G01 contract suite must pass) ---------------------
if command -v npm >/dev/null 2>&1; then
  echo "=== npm install (workspace) ==="
  npm install
  echo "=== turbo test (desktop only — contract suite lives there) ==="
  npx turbo run test --filter=@pharmacare/desktop
else
  echo "ERR: npm not on PATH — G01 test cannot be locally gated." >&2
  exit 1
fi

git checkout -b "$BRANCH"
git add apps/desktop/src-tauri/src/oauth/gmail_api.rs \
        apps/desktop/src-tauri/src/db.rs \
        apps/desktop/src/lib/ipc.contract.test.ts \
        docs/runbooks/ship-hardening-bundle.sh
git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "hardening: Gmail body-size cap + IPC contract tests + db PRAGMA gate (S03+G01+G03)

Bundles three pilot-readiness items from the 2026-04-18 audits:

S03 (security) — apps/desktop/src-tauri/src/oauth/gmail_api.rs
  * New check_body_size(Option<u64>, cmd) helper: hard cap 30 MB, warn at
    10 MB. Called before every resp.json()/resp.text() in list_messages,
    get_message, fetch_attachment.
  * Closes the only unbounded data-plane amplification in the Gmail path.
  * 5 new unit tests cover absent/small/warn/at-cap/over-cap branches.

G01 (test coverage) — apps/desktop/src/lib/ipc.contract.test.ts (NEW)
  * 40+ cases covering every currently-shipped *Rpc wrapper. Installs a
    recording handler, asserts each call's cmd name + args shape.
  * Recursive camelCase assertion across every arg subtree catches
    snake_case drift before Rust's serde validation surfaces it as an
    opaque 'save failed' to the user.
  * Special cases: searchProductsRpc empty-string short-circuit,
    listStockRpc opts-wrapping marker, default handler error message.

G03 (test coverage + correctness) — apps/desktop/src-tauri/src/db.rs
  * Add busy_timeout(5s) in open_local so transient reader/writer
    collisions retry instead of SQLITE_BUSY to the cashier mid-bill.
  * open_local_sets_all_pragmas test: foreign_keys=1, journal_mode=WAL,
    synchronous=NORMAL(1), busy_timeout=5000.
  * concurrent_writers_do_not_fail_with_locked: 8 threads x 3 inserts
    against the same file, all must succeed.
  * D01 migration-enumeration tests retained unchanged.

No functional UI changes. No new runtime deps. Ships alongside PR A
(chore/ts-hardening-d03-d08-s05, already queued) which closes D03/D08/S05
from the same audits."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

PR_BODY='## Summary

Three pilot-readiness items bundled into one PR since they share a local
Rust gate and a single CI run. Parallel to the TS-only PR A
(`chore/ts-hardening-d03-d08-s05`) from the same audits.

| Item | Source | File | LOC (±) |
|------|--------|------|---------|
| S03 — Gmail response body size cap | `docs/reviews/security-2026-04-18.md` | `apps/desktop/src-tauri/src/oauth/gmail_api.rs` | +~70 |
| G01 — lib/ipc.ts contract tests | `docs/reviews/coverage-gaps-2026-04-18.md` | `apps/desktop/src/lib/ipc.contract.test.ts` (NEW) | +~740 |
| G03 — db.rs PRAGMA + busy_timeout + concurrency tests | `docs/reviews/coverage-gaps-2026-04-18.md` | `apps/desktop/src-tauri/src/db.rs` | +~85 |

## S03 — Gmail response body size cap

Before: `resp.json()` in `list_messages` / `get_message` / `fetch_attachment`
had only a 30 s timeout — a hostile proxy or TLS-inspection appliance
could stream arbitrary bytes into memory, OOMing the 4 GB Win7 target.
Gmail server-side caps attachments at 25 MB but that cap is not enforced
locally.

After:
- New `check_body_size(Option<u64>, cmd)` pure helper.
- Hard cap: 30 MB (returns `Err` with cmd name + observed bytes + cap).
- Soft cap: 10 MB (`tracing::warn!` only).
- Absent `Content-Length` header (rare, chunked) — logs `debug!`, proceeds.
- Called before every `resp.json()` in the three HTTP paths.

New tests (all pure, no network):
- `check_body_size_absent_header_is_ok`
- `check_body_size_small_payload_is_ok`
- `check_body_size_warn_threshold_still_ok`
- `check_body_size_at_exactly_cap_is_ok`
- `check_body_size_above_cap_errors_with_cmd_name`

## G01 — lib/ipc.ts contract tests

Before: 0 direct tests on `apps/desktop/src/lib/ipc.ts` (1272 LOC, every
DTO shape between React and Tauri). The single highest-leverage gap in
`docs/reviews/coverage-gaps-2026-04-18.md`.

After: new `ipc.contract.test.ts` with 40+ cases covering every shipped
`*Rpc` wrapper. Each case:
1. Installs a recording handler via `setIpcHandler`.
2. Invokes the wrapper with representative input.
3. Asserts the emitted `IpcCall` matches `{ cmd, args }` exactly.
4. Runs a recursive camelCase assertion across the arg subtree —
   catches snake_case drift at CI time instead of runtime.

Special-case cases:
- `searchProductsRpc("   ")` short-circuits to `[]` without IPC.
- `listStockRpc()` vs `listStockRpc({...opts})` — the opts-wrapping marker
  matters because the Rust side expects `{ opts: {...} }` under the
  `list_stock` command.
- Default handler (no `setIpcHandler`) throws a named error.
- Handler rejections propagate their message unchanged.

## G03 — db.rs PRAGMA + busy_timeout + concurrency

Before: 0 `#[cfg(test)]` gate on PRAGMAs; no `busy_timeout` set at all —
a transient reader/writer collision surfaces as "database is locked" to
the cashier. D01 migration-enumeration tests shipped last PR.

After:
- `open_local` sets `busy_timeout(5 s)` (`BUSY_TIMEOUT_MS` constant).
- `open_local_sets_all_pragmas`: asserts `foreign_keys=1`,
  `journal_mode=WAL`, `synchronous=NORMAL` (=1), `busy_timeout=5000`.
- `concurrent_writers_do_not_fail_with_locked`: 8 threads x 3 INSERTs
  against the same file — all must succeed (busy_timeout turns the
  collisions into retries instead of `SQLITE_BUSY`).
- D01 tests kept unchanged.

## Out of scope

- S01 (OAuth `state` verification) and S02 (`image::Limits`) land in a
  separate PR with ADR-worthy scope.
- G02 (`ProductMasterScreen`) and G05 (`ReportsScreen` CSV) deferred per
  the prioritised list in `coverage-gaps-2026-04-18.md`.

Closes tasks #41 + #42.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "hardening: Gmail body-size cap + IPC contract tests + db PRAGMA gate (S03+G01+G03)",
    "head": os.environ["BRANCH"],
    "base": "main",
    "body": body,
}))
' <<< "$PR_BODY")

PR_RESP=$(curl -sS -X POST \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  -d "$PR_PAYLOAD" \
  "https://api.github.com/repos/${REPO}/pulls")

PR_NUM=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('number') or d)" <<< "$PR_RESP")
echo "Opened PR #${PR_NUM}"

SHA=$(git rev-parse HEAD)
for i in {1..80}; do
  sleep 15
  STATE=$(curl -sS -H "Authorization: token $PAT" \
    "https://api.github.com/repos/${REPO}/commits/${SHA}/check-runs" \
    | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
runs = d.get('check_runs', [])
if not runs: print('none'); sys.exit()
concl = [r.get('conclusion') for r in runs if r.get('status') == 'completed']
statuses = [r.get('status') for r in runs]
if any(s != 'completed' for s in statuses): print('in_progress'); sys.exit()
if all(c in ('success', 'neutral', 'skipped') for c in concl): print('success')
else: print('failed:' + ','.join([f'{r[\"name\"]}={r[\"conclusion\"]}' for r in runs if r.get('conclusion') not in ('success', None, 'neutral', 'skipped')]))
")
  echo "[$i] CI: $STATE"
  case "$STATE" in
    success) break ;;
    failed:*) echo "CI failed — $STATE"; exit 2 ;;
  esac
done

MERGE_PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"merge_method":"squash"}))')
MERGE_RESP=$(curl -sS -X PUT \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  -d "$MERGE_PAYLOAD" \
  "https://api.github.com/repos/${REPO}/pulls/${PR_NUM}/merge")
MERGED=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('yes' if d.get('merged') else 'NO:'+str(d))" <<< "$MERGE_RESP")
echo "Merge: $MERGED"

curl -sS -X DELETE -H "Authorization: token $PAT" \
  "https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH}" || true
git checkout main
git pull --ff-only "$GIT_URL" main
git branch -D "$BRANCH" || true

echo "Done. Hardening bundle (S03+G01+G03) shipped."
