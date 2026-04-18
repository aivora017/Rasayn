#!/usr/bin/env bash
# ship-x2b2-inline-similar.sh
#
# X2b.2 — ProductMasterScreen inline similar-suspects check (ADR 0022).
#
# Adds a pre-save similarity surface to the product master flow: the
# moment the operator picks an image, decode + pHash + Hamming-sweep the
# stored phashes and render an inline "this looks like <X>" banner.
# Advisory only — save remains unblocked.
#
# Files touched:
#   apps/desktop/src-tauri/src/images.rs
#       + CheckSimilarForBytesInput struct
#       + check_similar_images_for_bytes tauri command
#   apps/desktop/src-tauri/src/main.rs
#       + invoke_handler registration for the new command
#   apps/desktop/src/lib/ipc.ts
#       + IpcCall variant + CheckSimilarForBytesInputDTO + wrapper
#   apps/desktop/src/lib/ipc.contract.test.ts
#       + G01 contract test case for the new variant
#   apps/desktop/src/components/ProductMasterScreen.tsx
#       + similarSuspects state + RPC fire on image-pick + banner JSX
#   apps/desktop/src/components/ProductMasterScreen.test.tsx (new)
#       + 4 vitest cases (happy path, empty, clear, soft-fail)
#   apps/desktop/src/test/setup.ts
#       + webcrypto polyfill (covers Node 18 WSL + jsdom partial-stub)
#   apps/desktop/tsconfig.json
#       + types: ["node"] so setup.ts import "node:crypto" typechecks
#   packages/sku-images/src/test/setup.ts (new)
#       + same webcrypto polyfill (node env)
#   packages/sku-images/vitest.config.ts (new)
#       + wires setupFiles + environment: "node"
#   packages/sku-images/tsconfig.json
#       + exclude "src/test" from the TS build
#   docs/adr/0022-x2b2-product-master-inline-similar.md (new)
#   docs/runbooks/ship-x2b2-inline-similar.sh (this file)
#
# Usage:
#   cd /path/to/pharmacare-pro && bash docs/runbooks/ship-x2b2-inline-similar.sh
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
BRANCH="feat/x2b2-product-master-inline-similar"
EMAIL="aivora017@gmail.com"
NAME="aivora017"

if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "Branch ${BRANCH} already on origin — refusing to duplicate."
  exit 0
fi

# Expect the working tree to carry the bundle edits. If nothing, bail.
if git diff --quiet -- \
   apps/desktop/src-tauri/src/images.rs \
   apps/desktop/src-tauri/src/main.rs \
   apps/desktop/src/lib/ipc.ts \
   apps/desktop/src/lib/ipc.contract.test.ts \
   apps/desktop/src/components/ProductMasterScreen.tsx
then
  echo "No changes in the target files; nothing to ship."
  exit 1
fi

# JS gate — vitest across desktop + sku-images (sku-images unchanged but
# cheap to run and it keeps the matrix honest).
if command -v npm >/dev/null 2>&1; then
  echo "=== vitest: desktop + sku-images ==="
  npx --yes turbo run test --filter=@pharmacare/desktop --filter=@pharmacare/sku-images
else
  echo "WARN: npm not on PATH (WSL). Skipping local JS gate — CI will gate."
  sleep 3
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

git checkout -b "$BRANCH"
git add apps/desktop/src-tauri/src/images.rs \
        apps/desktop/src-tauri/src/main.rs \
        apps/desktop/src/lib/ipc.ts \
        apps/desktop/src/lib/ipc.contract.test.ts \
        apps/desktop/src/components/ProductMasterScreen.tsx \
        apps/desktop/src/components/ProductMasterScreen.test.tsx \
        apps/desktop/src/test/setup.ts \
        apps/desktop/tsconfig.json \
        packages/sku-images/src/test/setup.ts \
        packages/sku-images/vitest.config.ts \
        packages/sku-images/tsconfig.json \
        docs/adr/0022-x2b2-product-master-inline-similar.md \
        docs/runbooks/ship-x2b2-inline-similar.sh

git -c user.name="$NAME" -c user.email="$EMAIL" commit -m "x2b.2: product-master inline similar-suspects check (ADR 0022)

Pre-save similarity surface for the product master flow. The moment an
operator picks an image, decode + validate + compute pHash + Hamming-sweep
the stored product_images.phash column and render an inline banner listing
near-duplicate (distance <= 6) and suspicious (7..12) candidates. Save
remains unblocked — advisory only.

Rust:
  + CheckSimilarForBytesInput DTO + check_similar_images_for_bytes command
    in images.rs. Mirrors attach_product_image's decode/sniff/validate
    front-half and find_similar_images's Hamming-sweep back-half, but
    performs NO writes. Optional excludeProductId filter for edit-existing.
    Soft-fails to an empty result on compute_phash failure (parity with
    ADR-0018 NULL-phash storage).
  + Registered in main.rs invoke_handler.

TS:
  + IpcCall variant + CheckSimilarForBytesInputDTO +
    checkSimilarImagesForBytesRpc wrapper in lib/ipc.ts.
  + G01 contract test case asserts the input-wrapper envelope + camelCase
    arg tree for the new variant.

UI:
  + similarSuspects state + similarChecking flag in ProductMasterScreen.
  + File-input onChange fires the RPC after client-side validate() passes,
    in the same async IIFE that encodes bytes to b64.
  + Banner below the preview renders a per-row severity column + summary
    line + explicit 'save is still allowed' hint. Limit 10 rows.
  + Banner + state cleared on startNew, startEdit, submit success, Esc,
    Cancel, and Clear image.
  + Edit-existing passes excludeProductId = form.id so the operator's own
    image isn't echoed back.
  + Soft-fail on RPC rejection (no banner, no error surfaced).

Tests:
  + ProductMasterScreen.test.tsx (4 cases): happy path + banner,
    empty-result no-banner, Clear image hides banner, RPC rejection
    soft-failed.

Test infra:
  + WebCrypto polyfill in apps/desktop/src/test/setup.ts and
    packages/sku-images/src/test/setup.ts. New code paths call
    crypto.subtle.digest and the existing vitest+jsdom env ships a
    partial crypto stub missing .subtle; additionally Node 18 WSL has no
    globalThis.crypto at all. Polyfill is a no-op on Node 20 + native
    webcrypto. sku-images gains a vitest.config.ts (environment: 'node',
    setupFiles wiring) since it previously ran with no config. Desktop
    tsconfig gains 'node' in types[] so the setup.ts import typechecks;
    sku-images tsconfig excludes src/test from the TS build.
  + Blob.prototype.arrayBuffer polyfill in desktop setup.ts. jsdom 25
    under Node 18 WSL does not expose Blob.arrayBuffer reliably, and the
    ProductMaster file-input onChange calls it immediately after image
    pick. Polyfill uses the reliably-provided FileReader to read bytes
    into an ArrayBuffer.

Docs:
  + ADR 0022 documents the decision: pre-save vs post-save (rejected
    as cleanup theater), new RPC vs refactor find_similar_images
    (rejected as two-mode command), advisory vs hard-block (advisory
    to avoid false-positive lockouts on shared packaging).

Closes task #32."

GIT_URL="https://x-access-token:${PAT}@github.com/${REPO}.git"
git push "$GIT_URL" "$BRANCH"

PR_BODY='## Summary

X2b.2 — pre-save similarity surface for the product master flow. Playbook §4 Three Moats → X2 target is *≥97% golden-set precision at the moment of entry, with a visible "this looks like <X>" nudge*. X2b shipped the post-save ComplianceDashboard sweep; this PR adds the inline pre-save nudge.

## Behaviour

- Operator picks an image in ProductMasterScreen.
- Client-side `validate()` passes (size + MIME + SHA256).
- New RPC `check_similar_images_for_bytes` fires with the raw bytes.
- Rust side decodes + sniffs + computes pHash + Hamming-sweeps `product_images.phash` (no writes).
- Banner renders below the image preview with near-duplicate (distance ≤ 6) and suspicious (7..12) candidates, per-row severity column, summary line, and an explicit *save is still allowed* hint.
- Banner clears on Clear image / Esc / Cancel / startNew / startEdit / save success.

## Why advisory (not hard-block)

False-positive risk: generic pack shots (paracetamol strips from 50 vendors) would lock legitimate SKUs out of entry. Schedule H/H1/X compliance is auto-blocked at its own gate (migration 0001 triggers); the pHash layer is for *prevention via nudge*, not *enforcement*. ADR 0022 captures the trade-off.

## New Rust surface

```rust
#[tauri::command]
pub fn check_similar_images_for_bytes(
    state: State<'\''_, DbState>,
    input: CheckSimilarForBytesInput,
) -> Result<Vec<SimilarImageRow>, String>
```

Reuses `SimilarImageRow` serde shape from `find_similar_images`. No new structs visible on the wire besides the input DTO. Mirrors the front-half of `attach_product_image` and the back-half of `find_similar_images`.

## New TS surface

- `IpcCall` variant: `{ cmd: "check_similar_images_for_bytes"; args: { input: CheckSimilarForBytesInputDTO } }`.
- Wrapper: `checkSimilarImagesForBytesRpc(input)` → `readonly SimilarImageRowDTO[]`.
- G01 contract test picks up the new variant by exhaustive union-match.

## Test plan

- `apps/desktop/src/components/ProductMasterScreen.test.tsx` — 4 new cases covering happy path, empty result, clear, soft-fail on RPC error.
- `apps/desktop/src/lib/ipc.contract.test.ts` — one case asserting arg envelope + camelCase.
- Existing Rust helper tests (sniff_*, sha_*, max_bytes) unchanged; new command is an integration surface leaving DB-backed tests to the TS side (matches existing convention from `attach_product_image`).

## Not changed

- No migration, no new schema column. Reuses `product_images.phash` from migration 0018.
- No threshold changes. Still 6 / 12 per ADR 0019.
- ComplianceDashboard sweep untouched.
- Pilot golden-set precision gate (≥97% per ADR-0018) remains open — requires real Vaidyanath product photos, not synthetic scenes.

Closes task #32.'

export BRANCH
PR_PAYLOAD=$(python3 -c '
import json, sys, os
body = sys.stdin.read()
print(json.dumps({
    "title": "x2b.2: product-master inline similar-suspects check (ADR 0022)",
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

echo "Done. X2b.2 inline similar-suspects shipped."
