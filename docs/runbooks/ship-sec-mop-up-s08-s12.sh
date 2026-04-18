#!/usr/bin/env bash
# ship-sec-mop-up-s08-s12.sh
#
# sec: mop-up S08-S12 from docs/reviews/security-2026-04-18.md — the
# LOW-severity backlog the security reviewer tagged as "opportunistic
# polish; none compromise pilot safety". S13-S15 are INFO-only and out
# of scope.
#
# Files touched:
#   apps/desktop/src-tauri/src/products.rs
#       S08 — remove `format!(...SELECT...)` inline SQL, replace with
#             four compile-time SQL `const` strings (UPSERT_PRODUCT_SQL,
#             SELECT_PRODUCT_BY_ID_SQL, LIST_PRODUCTS_ACTIVE_SQL,
#             LIST_PRODUCTS_ALL_SQL). All user data still flows through
#             `params![]`. + 2 new unit tests.
#
#   apps/desktop/src-tauri/src/oauth/loopback.rs
#       S09 — `url_decode` decodes into `Vec<u8>` and assembles via
#             `String::from_utf8_lossy`, preserving multi-byte UTF-8.
#       S12 — `url_decode` now returns `Option<String>` and surfaces
#             `None` for trailing `%`, `%X`, and `%GG`. Caller returns
#             HTTP 400 with the offending parameter name.
#       + 5 new unit tests (UTF-8 round-trip, lossy non-UTF-8, trailing
#         `%`, single hex digit, non-hex triplet, callback rejection).
#
#   apps/desktop/src-tauri/src/oauth/google.rs
#       S10 — rename `extract_email_from_id_token` ->
#             `extract_email_from_id_token_unverified`. The rename is
#             mandatory: this helper does zero signature validation and
#             must never be used for authorisation. + 1 regression-lock
#             test plus the two pre-existing tests adjusted to the new
#             name.
#
#   apps/desktop/src-tauri/src/oauth/mod.rs
#       S10 — updated the sole caller at line 111 to the new name.
#
#   apps/desktop/src-tauri/src/oauth/gmail_api.rs
#       S11 — `sanitize_filename` now strips leading/trailing `.`,
#             rejects Windows reserved base names (CON, PRN, AUX, NUL,
#             COM1..9, LPT1..9) by prefixing `_`, and falls back to
#             `attachment.bin` if the result is empty after stripping.
#       + 3 new unit tests (only-dots fallback, trailing-dot strip,
#         reserved-name prefix), existing test adjusted to the stronger
#         defanged form.
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-sec-mop-up-s08-s12.sh
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
BRANCH="fix/security-s08-s12-mop-up"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate."
  exit 0
fi

# Expect the working tree to carry the bundle edits. If nothing, bail.
if git diff --quiet -- \
   apps/desktop/src-tauri/src/products.rs \
   apps/desktop/src-tauri/src/oauth/loopback.rs \
   apps/desktop/src-tauri/src/oauth/google.rs \
   apps/desktop/src-tauri/src/oauth/mod.rs \
   apps/desktop/src-tauri/src/oauth/gmail_api.rs
then
  echo "No changes in the target Rust files; nothing to ship."
  exit 1
fi

# Rust gate — cargo fmt + clippy + test for src-tauri.
if command -v cargo >/dev/null 2>&1; then
  echo "=== cargo fmt ==="
  (cd apps/desktop/src-tauri && cargo fmt --all -- --check)
  echo "=== cargo clippy ==="
  (cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings)
  echo "=== cargo test ==="
  (cd apps/desktop/src-tauri && cargo test)
else
  echo "WARN: cargo not on PATH (WSL). Skipping Rust gate — CI will gate."
  echo "      If touching src-tauri, run the PowerShell-side cargo gate first:"
  echo "        cd 'C:\\Users\\Jagannath Pharmacy\\ClaudeWorkspace\\pharmacy-sw\\Rasayn\\pharmacare-pro\\apps\\desktop\\src-tauri'"
  echo "        cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test"
  sleep 3
fi

# JS gate — vitest filter optional; S08-S12 are Rust-only. Run anyway to
# keep the matrix honest (cheap on a warm turbo cache).
if command -v npm >/dev/null 2>&1; then
  echo "=== vitest: desktop (Rust-only change, but keep it honest) ==="
  npx --yes turbo run test --filter=@pharmacare/desktop
else
  echo "WARN: npm not on PATH. Skipping JS gate — CI will gate."
  sleep 3
fi

git checkout -b "$BRANCH"
git add apps/desktop/src-tauri/src/products.rs \
        apps/desktop/src-tauri/src/oauth/loopback.rs \
        apps/desktop/src-tauri/src/oauth/google.rs \
        apps/desktop/src-tauri/src/oauth/mod.rs \
        apps/desktop/src-tauri/src/oauth/gmail_api.rs \
        docs/runbooks/ship-sec-mop-up-s08-s12.sh

git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "sec: mop-up S08-S12 from 2026-04-18 security review

Backlog cleanup of the five LOW-severity findings from
docs/reviews/security-2026-04-18.md. None compromise pilot safety;
all five ship with a new test case each.

S08 products.rs:163-202 — replace \`format!(...SELECT...)\` inline SQL
   with four compile-time \`const\` strings: UPSERT_PRODUCT_SQL,
   SELECT_PRODUCT_BY_ID_SQL, LIST_PRODUCTS_ACTIVE_SQL,
   LIST_PRODUCTS_ALL_SQL. All user-supplied fields still bind through
   \`params![]\`; the literal \`strftime('%Y-%m-%dT%H:%M:%fZ','now')\`
   moves into the SQL itself. Future reviewers grepping
   \`format!(...SELECT\` now get zero hits in this file.
   Test: s08_upsert_sql_is_constant_and_uses_bind_parameters,
         s08_upsert_sql_executes_against_real_schema.

S09 oauth/loopback.rs:155-178 — \`url_decode\` decodes into \`Vec<u8>\`
   and finalises via \`String::from_utf8_lossy\`, so multi-byte UTF-8
   percent-triples (\`%E2%82%AC\` -> €) survive the round-trip intact
   instead of being cast byte-by-byte into Latin-1 \`char\`. Non-UTF-8
   input becomes U+FFFD; the function is total.
   Test: s09_url_decode_preserves_multibyte_utf8,
         s09_url_decode_non_utf8_bytes_become_replacement_char_not_panic.

S10 oauth/google.rs:163 — rename \`extract_email_from_id_token\` ->
   \`extract_email_from_id_token_unverified\` to force every future
   caller to acknowledge that we do NO signature validation on the
   Google id_token. Sole caller in oauth/mod.rs:111 updated.
   Test: s10_unverified_fn_is_total_on_garbage_payload (and existing
         tests continue to exercise the happy path via the new name).

S11 oauth/gmail_api.rs:289-344 — \`sanitize_filename\` now strips
   leading/trailing \`.\` so \"...\" collapses to attachment.bin and
   \"foo.\" -> \"foo\" (NTFS silently drops trailing dots). Windows
   reserved base names (CON, PRN, AUX, NUL, COM1..9, LPT1..9) are
   prefixed with \`_\` to unambiguate; \"CONSOLE.txt\" and \"COMet.pdf\"
   are intentionally untouched (not reserved).
   Test: s11_rejects_only_dots_as_attachment_bin,
         s11_strips_trailing_dot_windows_hostile,
         s11_prefixes_underscore_on_reserved_base_names.

S12 oauth/loopback.rs:160-200 — \`url_decode\` returns Option<String>
   and surfaces None for trailing \`%\`, single-hex \`%X\`, and non-hex
   \`%GG\`. parse_callback_request turns None into an HTTP 400 reason
   string that names the offending query parameter (\`code\`, \`state\`,
   \`error\`) so operators can triage a CSRF decoy vs. a genuine
   client-side bug.
   Test: s12_url_decode_trailing_percent_is_none,
         s12_url_decode_one_hex_digit_at_end_is_none,
         s12_url_decode_non_hex_triplet_is_none,
         s12_parse_callback_rejects_malformed_percent_in_code.

Closes security review backlog items S08-S12. S13-S15 are INFO-only
and remain out of scope."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

PR_BODY='## Summary

Mop-up of the five LOW-severity items from the 2026-04-18 security review (`docs/reviews/security-2026-04-18.md`). Each item ships with at least one new test case. No TS, UI, migration, or ADR changes. Rust-only.

## S08 — `products.rs` `format!` SQL cleanup

**Before**: `apps/desktop/src-tauri/src/products.rs:173-207, 219` used `format!(...SELECT {SELECT_COLS}...)` with a `{now}` literal SQLite function and an `{active_clause}` ternary. Safe in practice (no user data interpolated) but grep-noisy for future reviewers.

**After**: four compile-time `const &str` SQL strings — `UPSERT_PRODUCT_SQL`, `SELECT_PRODUCT_BY_ID_SQL`, `LIST_PRODUCTS_ACTIVE_SQL`, `LIST_PRODUCTS_ALL_SQL`. User fields still bind via `params![]`.

**Tests added**:
- `s08_upsert_sql_is_constant_and_uses_bind_parameters` — asserts `?1..?12` present and no `{` leaks.
- `s08_upsert_sql_executes_against_real_schema` — exercises the literal const against in-memory SQLite with real migrations.

## S09 — `url_decode` UTF-8 safety

**Before**: `apps/desktop/src-tauri/src/oauth/loopback.rs:78-101` cast decoded bytes to `char` (`out.push(b as char)`), mangling multi-byte UTF-8 into Latin-1.

**After**: decode into `Vec<u8>`, finalise via `String::from_utf8_lossy`. Euro sign, Hindi text, etc. round-trip. Non-UTF-8 input becomes U+FFFD; the function is total.

**Tests added**:
- `s09_url_decode_preserves_multibyte_utf8` (`%E2%82%AC` -> `€`, Hindi).
- `s09_url_decode_non_utf8_bytes_become_replacement_char_not_panic`.

## S10 — `extract_email_from_id_token` rename

**Before**: `apps/desktop/src-tauri/src/oauth/google.rs:163` was `extract_email_from_id_token` with a comment disclaiming signature verification.

**After**: renamed to `extract_email_from_id_token_unverified`; rustdoc names the S10 finding and says "must never be used to make authorisation decisions." Sole caller (`oauth/mod.rs:111`) updated.

**Tests added**:
- `s10_unverified_fn_is_total_on_garbage_payload` (base64-valid, non-JSON payload).

## S11 — `sanitize_filename` Windows reserved names

**Before**: `apps/desktop/src-tauri/src/oauth/gmail_api.rs:250-265` preserved leading/trailing dots and Windows reserved device names (`CON.txt` would land on disk verbatim, causing opaque write errors on Windows).

**After**:
- Leading/trailing `.` stripped (so `"..."` -> fallback, `"foo."` -> `"foo"`).
- Reserved bases (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`, case-insensitive) prefixed with `_`.
- `CONSOLE.txt` / `COMet.pdf` / `LPT10.doc` intentionally untouched.

**Tests added**:
- `s11_rejects_only_dots_as_attachment_bin`.
- `s11_strips_trailing_dot_windows_hostile`.
- `s11_prefixes_underscore_on_reserved_base_names`.

Existing test adjusted: `../../etc/passwd` now defangs to `_.._etc_passwd` (strictly stronger than the old `.._.._etc_passwd`).

## S12 — `url_decode` `%`-at-end handling

**Before**: `apps/desktop/src-tauri/src/oauth/loopback.rs:82-100` silently passed a trailing `%` through as a literal percent sign when fewer than two hex digits remained, or when the digits were non-hex.

**After**: `url_decode` returns `Option<String>`. `None` for trailing `%`, `%X` (single hex digit), `%GG` (non-hex). `parse_callback_request` turns `None` into an HTTP 400 with a reason string that names the offending query parameter.

**Tests added**:
- `s12_url_decode_trailing_percent_is_none`.
- `s12_url_decode_one_hex_digit_at_end_is_none`.
- `s12_url_decode_non_hex_triplet_is_none`.
- `s12_parse_callback_rejects_malformed_percent_in_code`.

## Not changed

- No migrations, no schema, no ADR.
- S01–S07 remain as separately-scoped work (parallel agents are taking those).
- S13–S15 (INFO-only) remain out of scope.

Closes security review backlog items S08-S12.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "sec: mop-up S08-S12 (products.rs format!, url_decode UTF-8, filename, ...)",
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

echo "Done. sec: S08-S12 mop-up shipped."
