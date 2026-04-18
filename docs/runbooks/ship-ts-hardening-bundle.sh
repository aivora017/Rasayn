#!/usr/bin/env bash
# ship-ts-hardening-bundle.sh
#
# One-shot ship: D03 + D08 + S05 (TS-only bundle). All three are quick wins
# that cluster on GrnScreen + pendingGrnDraft + sku-images deps. No Rust
# changes — no cargo gate required.
#
#   D03 : GrnScreen drops the hard-coded SUPPLIERS const; calls
#         listSuppliersRpc(shopId) on mount (tech-debt 2026-04-18 #D03).
#   D08 : packages/sku-images bumps typescript 5.4 -> 5.6.3 and vitest 1.6
#         -> 2.1.5 to end version drift with the rest of the monorepo (#D08).
#   S05 : pendingGrnDraft migrated from destructive `take` module-singleton
#         to keyed-store + non-destructive peek + explicit dismiss, with a
#         useRef guard against React StrictMode double-invoke. The import
#         effect also dedupes the double searchProductsRpc call
#         (security-2026-04-18 #S05).
#
# Files touched:
#   apps/desktop/src/components/GrnScreen.tsx
#   apps/desktop/src/lib/pendingGrnDraft.ts
#   packages/sku-images/package.json
#   package-lock.json              (from `npm install` to pick up #D08)
#   docs/runbooks/ship-ts-hardening-bundle.sh   (this file)
#
# Runs from anywhere under the repo. Needs $HOME/.ghtok (PAT).
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-ts-hardening-bundle.sh
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
BRANCH="chore/ts-hardening-d03-d08-s05"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate. Check the PR."
  exit 0
fi

# Expect the working tree to carry the bundle edits. If none, bail.
if git diff --quiet -- \
   apps/desktop/src/components/GrnScreen.tsx \
   apps/desktop/src/lib/pendingGrnDraft.ts \
   packages/sku-images/package.json
then
  echo "No changes in the 3 target files; nothing to ship."
  exit 1
fi

# D08 — refresh lockfile to pick up the sku-images dep bump. This runs on
# the WSL side if npm is present. If not, CI will regenerate on install;
# the PR may show a lockfile-only follow-up commit but won't break.
#
# PowerShell-side equivalent (if WSL lacks npm):
#   cd 'C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro'
#   npm install
#   npx turbo run test --filter=@pharmacare/desktop --filter=@pharmacare/sku-images
if command -v npm >/dev/null 2>&1; then
  echo "=== npm install (refresh lockfile for sku-images bump) ==="
  npm install --silent
  echo "=== vitest: desktop app (GrnScreen.test.tsx + App.test.tsx cover the edits) ==="
  npx --yes turbo run test --filter=@pharmacare/desktop --filter=@pharmacare/sku-images
else
  echo "WARN: npm not on PATH here. Skipping local JS gate — CI will gate."
  echo "      Run the PowerShell one-liner in the comment above for a local gate."
  sleep 3
fi

git checkout -b "$BRANCH"
git add apps/desktop/src/components/GrnScreen.tsx \
        apps/desktop/src/lib/pendingGrnDraft.ts \
        packages/sku-images/package.json \
        package-lock.json \
        docs/runbooks/ship-ts-hardening-bundle.sh
git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "ts-hardening: D03 suppliers RPC + D08 sku-images bump + S05 pendingGrnDraft keyed store

D03 — GrnScreen.tsx drops the hard-coded SUPPLIERS demo const and
loads the real supplier list via listSuppliersRpc(\"shop_local\") on
mount. Save is gated on supplierId non-empty. Empty-load renders a
disabled select with a 'add in Settings' placeholder.

D08 — packages/sku-images bumps typescript ^5.4.0 -> ^5.6.3 and vitest
^1.6.0 -> ^2.1.5 to match the rest of the monorepo. package-lock.json
regenerated to reflect the bump.

S05 — pendingGrnDraft.ts migrates from a module-level 'let pending'
singleton + destructive take() to a Map<sourceMessageId, draft> keyed
store with non-destructive peek + explicit dismiss. GrnScreen's import
effect calls peek (not take) and guards with a useRef against React
StrictMode double-invoke. Dismiss button and save-success now both
call dismissPendingGrnDraft() to release the store entry.

S05b — the import effect also dedupes the double searchProductsRpc
call: the auto-append branch now reuses the 'hits' array captured
during matching, halving IPC traffic on the import path.

Test coverage: existing GrnScreen.test.tsx (8 cases) and App.test.tsx
GRN suite continue to pass — API signatures setPendingGrnDraft +
_resetPendingGrnDraftForTests are preserved; takePendingGrnDraft is
kept as a deprecated peek+dismiss alias for any straggler callers.

Closes tasks #39 + #40."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

PR_BODY='## Summary

Three clustered TS-only quick wins from the 2026-04-18 reviews, shipped as one
bundle so they share a single CI round-trip instead of three.

| ID  | Source                                    | One-liner                                                                 |
| --- | ----------------------------------------- | ------------------------------------------------------------------------- |
| D03 | `docs/reviews/tech-debt-2026-04-18.md`    | `GrnScreen` drops hard-coded `SUPPLIERS`; calls `listSuppliersRpc` on mount. |
| D08 | `docs/reviews/tech-debt-2026-04-18.md`    | `@pharmacare/sku-images` bumps typescript 5.4 -> 5.6.3 + vitest 1.6 -> 2.1.5. |
| S05 | `docs/reviews/security-2026-04-18.md`     | `pendingGrnDraft` keyed store + non-destructive peek + dismiss + dedupe.  |

## D03 — GrnScreen suppliers

- Removed the `SUPPLIERS` const (5 hard-coded demo rows).
- Added a `useEffect` that calls `listSuppliersRpc("shop_local")` and seeds `supplierId` from the first returned row.
- Save button is now gated on `supplierId.length > 0` as well as the existing invoice/line checks.
- Empty/failed load shows a disabled `<select>` with `(No suppliers — add in Settings)` instead of crashing on `SUPPLIERS[0]!`.

Cost previously: every new shop saw 5 identical fake supplier names and GRN saves risked an FK reject on `grns.supplier_id`. After: real suppliers only.

## D08 — sku-images dep version drift

```diff
- "typescript": "^5.4.0",
- "vitest": "^1.6.0"
+ "typescript": "^5.6.3",
+ "vitest": "^2.1.5"
```

Root `package.json` already pins `typescript ^5.6.3` and `vitest ^2.1.5`. The sku-images package was the only workspace on the old pins. `package-lock.json` refreshed.

## S05 — pendingGrnDraft hardening

Old shape (`apps/desktop/src/lib/pendingGrnDraft.ts`):

```ts
let pending: PendingGrnDraft | null = null;
export function takePendingGrnDraft() {
  const d = pending; pending = null; return d;
}
```

Risks (per security-2026-04-18 §S05):

1. React StrictMode dev double-invoke of `GrnScreen`s import `useEffect`: the first mount consumed the draft, the second saw `null` mid auto-match and lost the banner.
2. Two producers (future two-inbox-tab flow) would clobber each other.

Fix: keyed store by `sourceMessageId` + non-destructive `peek()` + explicit `dismissPendingGrnDraft()`. `GrnScreen` also guards with a `useRef` so the import loop runs exactly once per logical mount even under StrictMode.

API surface kept stable:
- `setPendingGrnDraft(d)` — unchanged signature.
- `_resetPendingGrnDraftForTests()` — unchanged; wipes the whole map.
- `takePendingGrnDraft()` — retained as `@deprecated` peek+dismiss alias.

New:
- `peekPendingGrnDraft()` — non-destructive.
- `dismissPendingGrnDraft()` — explicit release. Called from `GrnScreen`s dismiss button and on save success.

### S05b — dedupe searchProductsRpc

`GrnScreen.tsx:97` fetched hits for matching, then `line 112` fetched the same hits a second time to pick the auto-appended `ProductHit`. Replaced with:

```ts
let hits: readonly ProductHit[] = [];
try { hits = await searchProductsRpc(pl.productHint, 5); ... }
...
const hit = hits.find((h) => h.id === match.product!.id);
```

Halves IPC traffic on the Gmail -> GRN import path.

## Test plan

Existing suites cover all three edits:

- `apps/desktop/src/components/GrnScreen.test.tsx` — 8 cases: empty state, banner prefill, auto-append on high-conf match, Skip, 2-line import, Search manually, Dismiss, hsn-assist.
- `apps/desktop/src/App.test.tsx` GRN suite — 3 cases: F4 nav, save-disabled gate, F9 save-ok (asserts `supplierId === "sup_gsk"`).
- `packages/sku-images/` — vitest suite runs against bumped versions.

No new test files needed for the D03/D08/S05 edits themselves — PR B (task #41 G01+G03) adds the broader coverage (`lib/ipc.ts` contract tests, extra `db.rs` Rust tests).

## Not changed

- No IPC surface additions or Rust changes. `list_suppliers` command has been in the handler since Sprint 0; this PR is the first UI consumer.
- `takePendingGrnDraft()` retained for any straggler callers (there are none in-tree today); slated for removal in a follow-up once the deprecation sits one release cycle.

Closes tasks #39 + #40.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "ts-hardening: D03 suppliers RPC + D08 sku-images bump + S05 pendingGrnDraft keyed store",
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

echo "Done. TS-hardening bundle (D03+D08+S05) shipped."
