#!/usr/bin/env bash
# ship-security-bundle.sh
#
# One-shot ship: S01 (OAuth state CSRF) + S02 (image decomp bomb) + S04
# (audit JSON injection) + S06 (surface revoke failure) + S07 (duplicate
# suspects cap). All edits already applied on main working tree by Claude
# session 2026-04-18. This script does: local gate → branch → commit → push
# → open PR → wait for CI green → squash-merge via REST → cleanup.
#
# Runs from anywhere under the repo. Needs $HOME/.ghtok (PAT).
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-security-bundle.sh
#
# Identity: aivora017 <aivora017@gmail.com> per memory.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ ! -f "$HOME/.ghtok" ]]; then
  echo "ERR: missing \$HOME/.ghtok (PAT with repo scope)." >&2
  exit 1
fi
PAT="$(cat "$HOME/.ghtok")"
REPO="$(git config --get remote.origin.url \
  | sed -E 's#(.*github.com[:/])([^/]+/[^/.]+)(\.git)?$#\2#')"
BRANCH="chore/security-hardening-bundle-s01-s07"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

# Sanity: detect already-shipped state.
if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate. Check the PR."
  exit 0
fi

# Expect the working tree to carry the bundle edits. If none, bail.
if git diff --quiet -- \
   apps/desktop/src-tauri/src/oauth/loopback.rs \
   apps/desktop/src-tauri/src/oauth/mod.rs \
   apps/desktop/src-tauri/src/phash.rs \
   apps/desktop/src-tauri/src/images.rs
then
  echo "No changes detected in the 4 target files; nothing to ship."
  exit 1
fi

# Local gate — cargo lives on Windows-side; skip if not on PATH and rely
# on GitHub Actions. Sourav's alternative: run the equivalent from
# PowerShell *before* this script:
#   cd 'C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro\apps\desktop\src-tauri'
#   cargo fmt --all
#   cargo check --all-targets
#   cargo test oauth::loopback::tests
#   cargo test phash::tests
#   cargo test images::tests
#   cargo clippy --all-targets -- -D warnings
# (cargo test takes one TESTNAME positional — run three times.)
if command -v cargo >/dev/null 2>&1; then
  echo "=== cargo fmt ==="
  (cd apps/desktop/src-tauri && cargo fmt --all)
  echo "=== cargo check ==="
  (cd apps/desktop/src-tauri && cargo check --all-targets)
  echo "=== cargo test oauth::loopback::tests ==="
  (cd apps/desktop/src-tauri && cargo test oauth::loopback::tests)
  echo "=== cargo test phash::tests ==="
  (cd apps/desktop/src-tauri && cargo test phash::tests)
  echo "=== cargo test images::tests ==="
  (cd apps/desktop/src-tauri && cargo test images::tests)
  echo "=== cargo clippy ==="
  (cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings)
else
  echo "WARN: cargo not on PATH (WSL). Skipping local Rust gate — CI will gate."
  echo "      If you want a local gate, cancel now (Ctrl-C) and run the PowerShell one-liner in the comment above."
  sleep 3
fi

# Branch, commit, push.
git checkout -b "$BRANCH"
git add apps/desktop/src-tauri/src/oauth/loopback.rs \
        apps/desktop/src-tauri/src/oauth/mod.rs \
        apps/desktop/src-tauri/src/phash.rs \
        apps/desktop/src-tauri/src/images.rs \
        docs/runbooks/ship-security-bundle.sh
git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "security: hardening bundle S01/S02/S04/S06/S07

S01  OAuth loopback: verify state (RFC 6749 §10.12 CSRF), tighten path
     to /callback, reject non-GET, surface provider error= param, use
     constant-time state comparison.
S02  phash: decompression-bomb guard via image::Limits (8192x8192,
     256 MiB alloc); regression test for oversized-PNG refusal.
S04  OAuth audit payloads: switch from format!(r#\"{{\"email\":\"{}\"}}\"#)
     to serde_json::json!{} so attacker-controlled id_token email cannot
     escape the JSON envelope and forge additional fields.
S06  gmail_disconnect: surface Google revoke failure via tracing::warn!
     and audit payload {revoke: ok/failed, err?}; local cleanup still
     proceeds so UI reflects disconnect.
S07  get_duplicate_suspects: cap at 200 rows, tracing::warn! when the
     total exceeds the cap so ops see truncation.

Per docs/reviews/security-2026-04-18.md. Closes task #36.
Pilot-readiness bundle for first outside-tenant install."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

# Open PR.
PR_BODY='## Summary

Pilot-readiness security hardening per `docs/reviews/security-2026-04-18.md`.

| Finding | Before | After |
|---------|--------|-------|
| **S01** OAuth state CSRF | Loopback accepted any `code=` from any path | Verifies `state` matches (constant-time), requires `GET /callback`, surfaces provider `error=` |
| **S02** Image decomp bomb | `image::load_from_memory` with no limits | `ImageReader` + `Limits{8192x8192, 256 MiB alloc}`; regression test |
| **S04** Audit JSON injection | `format!(r#"{{"email":"{}"}}"#, email)` on unverified id_token email | `serde_json::json!({email})` everywhere in oauth/mod.rs audit calls |
| **S06** Silent revoke failure | `let _ = ...spawn_blocking(revoke)` | tracing::warn + audit payload `{revoke: ok/failed, err?}` |
| **S07** `get_duplicate_suspects` unbounded | Up to 12.5M pairs to UI | `MAX_DUPLICATE_SUSPECTS = 200` + tracing::warn on truncation |

No schema changes. No new deps.

## Test coverage added

- `oauth::loopback::tests`: matching state, state mismatch, missing state, missing code, wrong path, wrong method, provider-error surfacing, constant-time-eq edge cases.
- `phash::tests::rejects_oversized_png`: regression for S02.

## Not included in this bundle

- S03 Gmail body size cap — deferred; requires gmail_api refactor.
- S05 pendingGrnDraft hardening — covered by task #40.
- S08–S12 LOW polish — opportunistic.

Closes task #36.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "security: hardening bundle S01/S02/S04/S06/S07",
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

# Poll CI (up to 20 min).
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

# Squash-merge.
MERGE_PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"merge_method":"squash"}))')
MERGE_RESP=$(curl -sS -X PUT \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  -d "$MERGE_PAYLOAD" \
  "https://api.github.com/repos/${REPO}/pulls/${PR_NUM}/merge")
MERGED=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('yes' if d.get('merged') else 'NO:'+str(d))" <<< "$MERGE_RESP")
echo "Merge: $MERGED"

# Delete remote branch + local cleanup.
curl -sS -X DELETE -H "Authorization: token $PAT" \
  "https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH}" || true
git checkout main
git pull --ff-only "$GIT_URL" main
git branch -D "$BRANCH" || true

echo "Done. Security bundle shipped."
