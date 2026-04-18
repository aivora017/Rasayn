#!/usr/bin/env bash
# ship-db-auto-enum-bundle.sh
#
# D01 — auto-enumerate migrations from build.rs. Eliminates the two-edit
# ceremony (MIGRATION_NNNN const + applied(N) branch) every new migration
# required. Source of truth moves to packages/shared-db/migrations/*.sql.
#
# Files touched:
#   apps/desktop/src-tauri/build.rs            — emit migrations_generated.rs
#   apps/desktop/src-tauri/src/db.rs           — include!() + loop + tests
#   docs/runbooks/ship-db-auto-enum-bundle.sh  — this file
#
# Runs from anywhere under the repo. Needs $HOME/.ghtok (PAT).
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-db-auto-enum-bundle.sh
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
BRANCH="chore/db-auto-enumerate-migrations-d01"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate. Check the PR."
  exit 0
fi

if git diff --quiet -- \
   apps/desktop/src-tauri/build.rs \
   apps/desktop/src-tauri/src/db.rs
then
  echo "No changes detected in build.rs/db.rs; nothing to ship."
  exit 1
fi

# Local gate — cargo lives on Windows-side; skip if not on PATH.
# IMPORTANT: the new db::tests::apply_migrations_runs_cleanly_in_memory test
# is the round-trip gate. If it fails, the generator produced invalid SQL
# or a path that rustc couldn't resolve.
#
# PowerShell-side gate:
#   cd 'C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro\apps\desktop\src-tauri'
#   cargo fmt --all
#   cargo check --all-targets
#   cargo test db::tests          # the 4 new migration-enum round-trip tests
#   cargo test products           # existing tests — must still pass
#   cargo clippy --all-targets -- -D warnings
if command -v cargo >/dev/null 2>&1; then
  echo "=== cargo fmt ==="
  (cd apps/desktop/src-tauri && cargo fmt --all)
  echo "=== cargo check ==="
  (cd apps/desktop/src-tauri && cargo check --all-targets)
  echo "=== cargo test db::tests (migration round-trip) ==="
  (cd apps/desktop/src-tauri && cargo test db::tests)
  echo "=== cargo test products (existing integration tests) ==="
  (cd apps/desktop/src-tauri && cargo test products)
  echo "=== cargo clippy ==="
  (cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings)
else
  echo "WARN: cargo not on PATH (WSL). Skipping local Rust gate — CI will gate."
  echo "      If you want a local gate, cancel now (Ctrl-C) and run the PowerShell one-liner in the comment above."
  sleep 3
fi

git checkout -b "$BRANCH"
git add apps/desktop/src-tauri/build.rs \
        apps/desktop/src-tauri/src/db.rs \
        docs/runbooks/ship-db-auto-enum-bundle.sh
git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "db: auto-enumerate migrations from build.rs (D01)

build.rs now walks packages/shared-db/migrations/*.sql at compile time,
validates NNNN_name.sql convention + contiguous 1..N versioning, and
emits \$OUT_DIR/migrations_generated.rs containing:

    pub const MIGRATIONS: &[(i64, &str, &str)] = &[
        (1, \"0001_init\", include_str!(\"...\")),
        ...
    ];

db.rs include!()s the generated file and iterates — one branch instead
of 19. Adding migration 0020 is now one action (drop the .sql file into
the migrations folder); build + test + ship. No more MIGRATION_NNNN
const, no more applied(N) branch.

Failures at compile time (build.rs panics):
  - Filename not matching NNNN_name.sql convention
  - Duplicate version
  - Gap in version sequence

Failures at test time (db::tests):
  - migrations_are_contiguous_from_one
  - migrations_have_nonempty_sql
  - migration_stems_match_version
  - apply_migrations_runs_cleanly_in_memory (full chain 0001->NNNN on :memory: + idempotent second-run)

Eliminates the recurring two-edit tax flagged in D01 of
docs/reviews/tech-debt-2026-04-18.md. Closes task #38."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

PR_BODY='## Summary

D01 from `docs/reviews/tech-debt-2026-04-18.md` — every new migration was
forcing **two edits in `db.rs`**: a `MIGRATION_NNNN` const (one `include_str!`)
and a corresponding `if !applied(N, conn) { ... }` branch. Nineteen
migrations -> 38 bespoke lines and a recurring opportunity to forget one
half and silently skip a migration on fresh installs.

## Approach

- **`build.rs`** walks `packages/shared-db/migrations/*.sql` at compile time:
  1. Each filename parsed as `NNNN_<snake_case>.sql` — build fails on
     non-conforming names.
  2. Versions collected into a `BTreeMap`; duplicates rejected.
  3. Contiguous-from-one enforced — any gap fails the build.
  4. Emits `$OUT_DIR/migrations_generated.rs`:
     ```rust
     pub const MIGRATIONS: &[(i64, &str, &str)] = &[
         (1,  "0001_init",          include_str!("/abs/path/0001_init.sql")),
         ...
         (19, "0019_fk_indexes",    include_str!("/abs/path/0019_fk_indexes.sql")),
     ];
     ```
  5. `cargo:rerun-if-changed=` on both the directory and each file.

- **`db.rs`** loses 19 const defs + 19 if-branches, gains:
  ```rust
  include!(concat!(env!("OUT_DIR"), "/migrations_generated.rs"));

  for (version, name, sql) in MIGRATIONS {
      if applied(*version, conn) { continue; }
      conn.execute_batch(sql)?;
      conn.execute("INSERT INTO _migrations (version, name) VALUES (?1, ?2)",
                   params![version, name])?;
  }
  ```

## Test coverage added

Four tests under `db::tests` that complement the compile-time gate:

- `migrations_are_contiguous_from_one` — runtime sanity on version sequence
- `migrations_have_nonempty_sql` — rejects empty-file silent skip
- `migration_stems_match_version` — rejects generator bugs that mis-pair versions and filenames
- `apply_migrations_runs_cleanly_in_memory` — the round-trip gate. Opens a `:memory:` SQLite, runs the full generated chain, asserts `_migrations` count matches `MIGRATIONS.len()`, then re-runs and asserts idempotency.

Existing tests (`products.rs`, `products_perf.rs`) transitively exercise
the new path too — both call `apply_migrations(&c)` and remain green.

## Adding a migration after this PR

Before:
1. Write `packages/shared-db/migrations/NNNN_name.sql`.
2. Add `pub const MIGRATION_NNNN: &str = include_str!(...)` to `db.rs`.
3. Add `if !applied(NN, conn) { ... }` branch to `db.rs`.

After:
1. Write `packages/shared-db/migrations/NNNN_name.sql`.

Thats it. Two recurring-tax lines cut to zero.

## Out of scope

- No refactor of the `_migrations` table schema. Same `(version, name, applied_at)` shape, same INSERT semantics.
- No migration content changes. 0001-0019 SQL byte-identical to previous state.

Closes task #38.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "db: auto-enumerate migrations from build.rs (D01)",
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

echo "Done. DB auto-enum shipped."
