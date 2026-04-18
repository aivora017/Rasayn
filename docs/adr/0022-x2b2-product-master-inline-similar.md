# ADR 0022 — X2b.2 Product-master inline similar-suspects check

**Status**: Accepted · 2026-04-18
**Scope**: ProductMasterScreen image-select flow only. ComplianceDashboard
sweep (ADR 0019) and the pilot golden-set precision gate remain separate work.
**Supersedes**: none. Extends ADR-0018 (X2a) and ADR-0019 (X2b).

## Context

X2b shipped a pairwise-sweep "Duplicate suspects" surface in
ComplianceDashboard — good for owner-side cleanup, bad for *prevention*.
Two problems motivate this ADR:

1. **Cleanup theater.** By the time ComplianceDashboard flags a duplicate pair,
   the operator has already created the second product row and attached its
   image. Cleanup requires a deactivation + audit trail that is more work than
   the original save. The moat case is *"don't let the shop create the
   duplicate in the first place"*.
2. **X2b.2 playbook item.** §4 Three Moats → X2 targets ≥97% golden-set
   precision at the moment of entry, with a visible "this looks like <X>"
   nudge in the UI. The current product-master flow has no such nudge.

Two candidate designs were considered:

**Option A — post-save advisory.** Reuse `find_similar_images(productId)`
*after* save lands. Rejected: the product + image are already committed, so
the "warning" is a deactivation prompt, not prevention. Same UX as the
dashboard, just relocated. Doesn't change the moat.

**Option B — pre-save check on bytes (chosen).** Introduce a new Rust
command `check_similar_images_for_bytes(bytesB64, reportedMime,
excludeProductId, maxDistance)` that decodes, validates, computes pHash,
sweeps the existing `product_images.phash` column, and returns nearest
neighbours — **without inserting anything**. Call it from
ProductMasterScreen the moment the operator picks an image. Render an
inline banner below the preview with the suspect table. Save is still
permitted — the banner is advisory, not a hard block (Hard Rule 5 autonomy:
compliance is auto-blocked at the *Schedule H/H1/X* layer, not the
"looks-like" layer, to avoid false-positive lockouts).

## Decision

### New Rust command (`apps/desktop/src-tauri/src/images.rs`)

```rust
#[tauri::command]
pub fn check_similar_images_for_bytes(
    state: State<'_, DbState>,
    input: CheckSimilarForBytesInput,
) -> Result<Vec<SimilarImageRow>, String>
```

Input DTO:

| Field              | Rust type         | Purpose                                              |
|--------------------|-------------------|------------------------------------------------------|
| `bytesB64`         | `String`          | Base64 of the raw bytes the operator just picked     |
| `reportedMime`     | `Option<String>`  | Advisory MIME from browser                           |
| `excludeProductId` | `Option<String>`  | Product being edited — excluded from results         |
| `maxDistance`      | `u32`             | Hamming ceiling (UI passes 12)                       |

Reuses the `SimilarImageRow` serde shape from `find_similar_images`, so the
UI and contract tests share DTOs with the existing X2b surface.

Flow mirrors the front-half of `attach_product_image` (decode → size cap →
MIME sniff → MIME-mismatch log) and the back-half of `find_similar_images`
(Hamming sweep over `product_images.phash`). **No writes.** If
`compute_phash` fails (pathological decode), the command returns empty —
soft-fail parity with the `NULL phash` storage policy from ADR-0018 so the
UI never blocks save on a phash glitch.

### TS IPC wrapper (`apps/desktop/src/lib/ipc.ts`)

```ts
export async function checkSimilarImagesForBytesRpc(
  input: CheckSimilarForBytesInputDTO,
): Promise<readonly SimilarImageRowDTO[]>;
```

IpcCall variant added to the discriminated union so G01 contract tests
still cover every variant by exhaustive name-match.

### ProductMasterScreen wiring

- State: `similarSuspects: readonly SimilarImageRowDTO[]` plus
  `similarChecking: boolean`.
- Cleared on: `startNew`, `startEdit`, submit success, `Clear image`, Esc,
  and Cancel.
- Fired from: the file-input `onChange` *after* client-side
  `validate()` succeeds, in the same async IIFE that encodes bytes to b64.
- On RPC error: set `similarSuspects = []` silently (soft-fail).
- When editing an existing product, `excludeProductId = form.id` so the
  operator's own current image isn't echoed back as a duplicate.

### Severity surfacing (UI-only thresholds)

Per ADR 0019:

| Hamming distance | Severity         |
|------------------|------------------|
| `≤ 6`            | `near-duplicate` |
| `7…12`           | `suspicious`     |
| `> 12`           | not surfaced     |

Banner renders a per-row severity column + a summary line
("1 near-duplicate, 2 suspicious matches"), and an explicit hint that save
is still allowed. Limit: 10 rows in the table (`slice(0, 10)`) to prevent
the form from being pushed off-screen in the worst case — the full list is
reachable via ComplianceDashboard.

## Consequences

### Positive
- Prevents duplicate-SKU entry at the *moment of entry*, not on a
  downstream cleanup pass.
- Reuses every existing helper (decode + sniff + validate + pHash +
  Hamming). Incremental Rust surface is ~90 lines of new code + 15 lines
  of TS + ~100 lines of JSX; no migration, no new schema.
- Contract tests (G01) pick up the new IpcCall variant via the discriminated
  union, so rename drift stays detectable at CI time.
- New RPC is callable from any future screen that edits images pre-save
  (e.g. X3 photo-of-paper-bill → GRN, if that flow ever lands image capture).

### Negative / trade-offs
- Every image pick now incurs one extra RPC round-trip (decode + pHash +
  N-row Hamming sweep). At pilot scale (≤5k SKUs, 64-bit popcount) the
  measured cost is ≤10 ms on the pilot hardware floor — below the <2s
  keyboard-path budget. No action needed yet. If N ever crosses 50k, the
  `substr(phash, 1, 2)` prefix-bucket plan from ADR 0019 applies equally
  here.
- Client does two pHash-equivalent computations per pick: `validate()`
  computes SHA256 client-side, then the RPC recomputes SHA256 + pHash
  server-side. Acceptable — SHA256 on a ≤2 MiB blob is ~5 ms; pHash is ~3 ms.
  Total budget intact.
- Advisory-only banner could be dismissed by an operator who assumes "save
  is safe", creating the duplicate anyway. Mitigation: the ComplianceDashboard
  sweep still runs — duplicates that slip through entry are caught at
  weekly review. Hard-block was considered and rejected for false-positive
  risk (shared packaging across legitimate SKUs, e.g. generic paracetamol
  strips).
- One more `setIpcHandler` branch every test must mock. Handled by adding
  `check_similar_images_for_bytes` to the default test handler returning `[]`.

### Not addressed (follow-up)
- Pilot golden-set precision gate (≥97% per ADR-0018). Requires real
  Vaidyanath product photos, not synthetic scenes. Tracked as Task #32's
  remaining work: *"replace synthetic scenes with actual pilot product
  images; hit ADR-0018 ≥97% gate"*.
- Multi-image-per-product (currently PK = `product_id`, one image per
  product). Out of scope; ADR-0018 defers this deliberately.
- Hard-blocking duplicates for Schedule H/H1/X specifically. Possible
  X2b.3 follow-up if pilot data shows the advisory banner is routinely
  ignored for controlled classes.

## Alternatives considered

### A. Post-save advisory (rejected)
Call `find_similar_images(saved.id)` after upsert + attach. Reuses the
existing command verbatim — *zero* new Rust surface. But the save has
already committed, so the warning is a deactivation prompt, not prevention.
Doesn't change the moat. Rejected.

### B. Refactor `find_similar_images` to accept bytes (rejected)
Extend the existing command with an optional `bytesB64` arg that takes
precedence over `productId`. Rejected because: (i) it violates the DTO's
current meaning ("find neighbours of an existing product"), (ii) the call
sites already in ComplianceDashboard would need to keep passing
`productId`, creating a confusing two-mode command, and (iii) a separate
command keeps the G01 contract test's exhaustive-variant guarantee clean.

### C. Client-side pHash (rejected)
Port the DCT-based pHash to TS (running in the renderer). Would eliminate
the RPC round-trip. Rejected: the DCT implementation is non-trivial,
already validated against a Rust golden set in ADR-0019, and client-side
image decode in WebView2 on Windows 7 is inconsistent across codec
versions. Keep the canonical implementation in Rust.

## Supersedes / Superseded-by
- Supersedes: none.
- Superseded-by: none.
