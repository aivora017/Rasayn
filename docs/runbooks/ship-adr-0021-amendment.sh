#!/usr/bin/env bash
# ship-adr-0021-amendment.sh
#
# Doc-only: ADR 0021 (A8 partial refund) renumber migration 0019 → 0020
# because PR #27 (276de46) landed migration 0019 = FK indexes first.
#
# Files touched:
#   docs/adr/0021-a8-partial-refund.md
#   docs/runbooks/ship-adr-0021-amendment.sh  (this file)
#
# Runs from anywhere under the repo. Needs $HOME/.ghtok (PAT).
# No cargo gate — doc-only.
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-adr-0021-amendment.sh
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
BRANCH="docs/adr-0021-renumber-0020"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate. Check the PR."
  exit 0
fi

if git diff --quiet -- docs/adr/0021-a8-partial-refund.md; then
  echo "No change in docs/adr/0021-a8-partial-refund.md; nothing to ship."
  exit 1
fi

git checkout -b "$BRANCH"
git add docs/adr/0021-a8-partial-refund.md \
        docs/runbooks/ship-adr-0021-amendment.sh
git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "docs(adr-0021): renumber A8 migration 0019 -> 0020

PR #27 shipped migration 0019 = FK indexes (D04 tech-debt). A8 ADR
originally claimed 0019; renumber all references to 0020 and add a
one-paragraph amendment note at the top explaining the history.

No code changes. No schema changes. No plan-of-record changes beyond
the migration number.

Closes task #43."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

PR_BODY='## Summary

Doc-only ADR amendment. PR #27 (`276de46`) landed migration 0019 as FK
indexes (D04 tech-debt) ahead of A8 implementation. ADR 0021 had planned
to claim 0019 for `return_headers` / `return_lines` / `return_no_counters`
/ `credit_notes` schema — now renumbered to **0020** throughout.

## Changed refs

- `§Migration 0019 — schema DDL` → `§Migration 0020 — schema DDL`
- `-- Migration 0019 · A8 Partial Refund` → `-- Migration 0020 · A8 Partial Refund`
- `Table count contributed by migration 0019` → `… 0020`
- Two `Migration 0019 addendum` blocks (`shop_settings` column, `return_no_counters` table) → `0020`
- `§Implementation sequencing` step 1 + step 3 → `migration 0020`
- Status-banner `Ready for migration 0019 authoring` → `0020`
- **Added:** one-paragraph `Amendment 2026-04-18-b` note at the top with the renumber history.

The two remaining `0019` hits in the file are in that amendment note —
intentional, they document the history.

## Not changed

- No code. No schema. No test plan. No ADR supersedes/superseded-by chain.
- `docs/reviews/tech-debt-2026-04-18.md` still correctly refers to the
  D04 fix as `0019_fk_indexes.sql` — that is the shipped state.

Closes task #43.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "docs(adr-0021): renumber A8 migration 0019 -> 0020",
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

# Poll CI — docs-only, but respect the gate anyway (lint/spellcheck may run).
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
    success|none) break ;;
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

echo "Done. ADR 0021 amendment shipped."
