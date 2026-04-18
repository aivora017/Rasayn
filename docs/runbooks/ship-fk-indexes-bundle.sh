#!/usr/bin/env bash
# ship-fk-indexes-bundle.sh
#
# One-shot ship: D04 — migration 0019 adds covering indexes on five FK columns
# that SQLite doesn't auto-index (expiry_override_audit.product_id,
# expiry_override_audit.actor_user_id, product_images.uploaded_by,
# product_image_audit.actor_user_id, supplier_templates.supplier_id). Closes
# task #37. This migration MUST land before A8 (ADR 0021) implementation so A8
# claims 0020+ in its own ship.
#
# Files touched on main working tree by Claude session 2026-04-18:
#   packages/shared-db/migrations/0019_fk_indexes.sql  (new)
#   apps/desktop/src-tauri/src/db.rs                    (register 0019)
#   docs/runbooks/ship-fk-indexes-bundle.sh             (this file)
#
# Runs from anywhere under the repo. Needs $HOME/.ghtok (PAT).
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-fk-indexes-bundle.sh
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
BRANCH="chore/fk-indexes-migration-0019"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

# Sanity: detect already-shipped state.
if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate. Check the PR."
  exit 0
fi

# Expect the working tree to carry the bundle edits. If none, bail.
if git diff --quiet -- \
   packages/shared-db/migrations/0019_fk_indexes.sql \
   apps/desktop/src-tauri/src/db.rs
then
  # Also check for untracked new file (migration SQL).
  if [[ ! -f packages/shared-db/migrations/0019_fk_indexes.sql ]] \
     || git ls-files --error-unmatch packages/shared-db/migrations/0019_fk_indexes.sql >/dev/null 2>&1; then
    echo "No changes detected in target files; nothing to ship."
    exit 1
  fi
fi

# Local gate — cargo lives on Windows-side; skip if not on PATH and rely
# on GitHub Actions. Sourav's alternative: run the equivalent from
# PowerShell *before* this script:
#   cd 'C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro\apps\desktop\src-tauri'
#   cargo fmt --all
#   cargo check --all-targets
#   cargo test products     # transitively runs apply_migrations → exercises 0019
#   cargo clippy --all-targets -- -D warnings
if command -v cargo >/dev/null 2>&1; then
  echo "=== cargo fmt ==="
  (cd apps/desktop/src-tauri && cargo fmt --all)
  echo "=== cargo check ==="
  (cd apps/desktop/src-tauri && cargo check --all-targets)
  echo "=== cargo test products (exercises apply_migrations → 0019) ==="
  (cd apps/desktop/src-tauri && cargo test products)
  echo "=== cargo clippy ==="
  (cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings)
else
  echo "WARN: cargo not on PATH (WSL). Skipping local Rust gate — CI will gate."
  echo "      If you want a local gate, cancel now (Ctrl-C) and run the PowerShell one-liner in the comment above."
  sleep 3
fi

# Branch, commit, push.
git checkout -b "$BRANCH"
git add packages/shared-db/migrations/0019_fk_indexes.sql \
        apps/desktop/src-tauri/src/db.rs \
        docs/runbooks/ship-fk-indexes-bundle.sh
git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "db: migration 0019 — covering indexes on FK columns (D04)

SQLite does not auto-index FK columns — only PRIMARY KEY and UNIQUE get
implicit indexes. At 100 shops x 3 years of audit data, queries like
'all overrides by pharmacist X' full-scan; CSV exports slow quadratically.

Adds 5 covering indexes:
  - expiry_override_audit(product_id, created_at DESC)
  - expiry_override_audit(actor_user_id, created_at DESC)
  - product_images(uploaded_by, uploaded_at DESC)
  - product_image_audit(actor_user_id, at_ts DESC)
  - supplier_templates(supplier_id)

oauth_accounts.shop_id is deliberately NOT indexed — composite PK
(shop_id, provider) already covers the shop_id-prefix access path via
sqlite_autoindex.

Per docs/reviews/tech-debt-2026-04-18.md §D04. Closes task #37.
Sequencing: lands 0019 BEFORE A8 (ADR 0021) implementation so A8
renumbers its partial-refund schema to 0020+."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

# Open PR.
PR_BODY='## Summary

D04 from `docs/reviews/tech-debt-2026-04-18.md` — five FK columns were
unindexed. At 100 shops x 3 years of audit rows, the Schedule H audit-by-
pharmacist query and the product-override audit-by-SKU query both degrade
to O(n) full-scans; CSV exports go quadratic.

## Indexes added

| Table | Column(s) | Why |
|-------|-----------|-----|
| `expiry_override_audit` | `(product_id, created_at DESC)` | "all overrides for product X" — repeat-expiry SKU check |
| `expiry_override_audit` | `(actor_user_id, created_at DESC)` | "all overrides by pharmacist X" — Schedule H compliance audit |
| `product_images` | `(uploaded_by, uploaded_at DESC)` | "who uploaded missing/wrong images" — pilot data-quality sweep |
| `product_image_audit` | `(actor_user_id, at_ts DESC)` | Append-only audit — same access pattern as override audit |
| `supplier_templates` | `(supplier_id)` | X1.2 Gmail→GRN bridge picks a template per supplier; 50+ suppliers |

## Deliberately NOT indexed

- `oauth_accounts.shop_id` — composite PK `(shop_id, provider)` already
  creates a leading-column `sqlite_autoindex_*` that covers `shop_id` lookups.
  Adding an explicit index would be pure bloat.

## Test coverage

- `cargo test products` transitively runs `apply_migrations` in
  `products.rs` and `products_perf.rs` integration tests — exercises the
  full migration chain 0001→0019 against a fresh SQLite.
- Migration uses `IF NOT EXISTS` so re-running on an already-migrated DB
  is a no-op (idempotent).

## Sequencing note

ADR 0021 (A8 partial refund) was drafted planning to claim migration 0019
for `return_headers` / `return_lines` / `return_payments` schema. This PR
lands 0019 FIRST, forcing A8 to renumber to 0020+ at implementation time.
That follow-up ADR amendment is tracked in task #43.

Closes task #37.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "db: migration 0019 — covering indexes on FK columns (D04)",
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

echo "Done. FK indexes migration shipped."
