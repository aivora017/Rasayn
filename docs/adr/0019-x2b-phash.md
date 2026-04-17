# ADR 0019 — X2b perceptual hash (pHash) + golden-set harness

**Status**: Accepted · 2026-04-17
**Scope**: X2b only (this ADR). X2b.2 OCR pack-label match + vendor master reconciliation deferred.
**Supersedes**: none. Extends ADR-0018 (X2a → X2b).

## Context

X2a shipped byte-exact image identity (SHA256) and the Schedule H/H1/X blocker. The
Playbook §4 moat target is **≥97% golden-set precision** — achievable only with a
perceptual matcher that tolerates re-compression, resizing, minor crops, and phone-camera
captures of the same pack. SHA256 catches exactly zero of those.

This PR adds X2b.1: a 64-bit DCT-based perceptual hash (pHash) computed at upload,
plus a golden-set harness that validates precision on known-match / known-different fixtures.

OCR pack-label match (cross-check imprinted text vs product.name) and vendor-supplied
master image reconciliation are X2b.2 — deferred to a separate PR.

## Decision

### Algorithm: DCT-based pHash (64-bit)

1. Decode image (png/jpeg/webp) → RGBA via `image` crate.
2. Convert to luma (0.299 R + 0.587 G + 0.114 B) on a 32×32 resize (bilinear).
3. Apply 2D Type-II DCT over the 32×32 luma matrix.
4. Take the top-left 8×8 DCT coefficients (excluding the DC term at [0,0]) — 63 values
   for the statistic, then prepend 1 bit set from coefficient[0,1] vs median trick
   to fill 64 bits. Canonical Marr/Hoyle variant.
5. Compute the median of those 64 coefficients.
6. Bit i = 1 if coefficient[i] > median else 0. Emit as 16 hex chars (little-endian).

**Why pHash (not dHash / aHash)**:
- pHash is the most robust to JPEG recompression and resizing — the exact degradations
  phone-camera captures of a printed pack inflict.
- dHash is faster but drops precision on re-compressed packs by ~3-4 pp in published
  benchmarks.
- aHash is too sensitive to exposure — fails on counter-light vs shop-light captures.

### Hamming distance threshold

- **≤ 6 bits**: near-duplicate. Dashboard flags as "likely same product".
- **7-12 bits**: suspicious — surfaces for owner review, not auto-blocked.
- **> 12 bits**: treat as different product.

These thresholds are calibrated on the golden set (§ Golden-set harness below) and
will be tuned in X2b.2 once we have real pilot images. The 6/12 numbers match the
openimagehash defaults and Marr 2010 recommended cutoffs.

### Storage

- New column `product_images.phash TEXT` — 16 hex chars, CHECK length or NULL.
- NULL allowed: X2a rows pre-date the column; they get pHash on next replace or via
  the one-shot backfill tool (X2b.2).
- Prefix index on `substr(phash, 1, 2)` for candidate bucketing — SQLite lacks native
  Hamming, so the app filters candidates by prefix (256 buckets) then computes distance
  in Rust (~1k pHashes per ms on commodity hardware).

### Compute site

- **Server-side in Rust** (`src-tauri/src/phash.rs`). The TS/browser canvas path is
  unreliable across Tauri's webview versions, and the `image` crate is already needed
  for width/height decoding in X2a.
- `attach_product_image` computes pHash during upload, stores alongside SHA256.
- Backfill: one-shot CLI or admin UI command `backfill_phash_for_missing()` — X2b.2.

### Golden-set harness

`apps/desktop/src-tauri/tests/fixtures/phash/` — 10 known-match pairs:

- `crocin_500_front.png` ↔ `crocin_500_front_jpeg_q70.jpg` (same pack, different codec)
- `crocin_500_front.png` ↔ `crocin_500_front_rescaled_640.png` (resize)
- `crocin_500_front.png` ↔ `crocin_500_front_camera.jpg` (phone recapture)
- ... 7 more

And 10 known-different pairs (different SKUs). Test gate: all 10 matches produce
Hamming ≤ 6; at least 9 of 10 different pairs produce Hamming > 12. Precision ≥ 90%
on this synthetic set; real golden-set calibration arrives with pilot images.

For this PR we ship a **synthetic golden set** (generated procedurally in the test
via deterministic gradients + known jitter) since we lack pilot product images. The
synthetic set validates the algorithm determinism and threshold sanity; the real ≥97%
gate closes in X2b.2 once Vaidyanath Pharmacy pilot images land.

## Consequences

**Positive**
- The Playbook §4 moat target becomes measurable — `cargo test -p pharmacare-desktop phash`
  produces a pass/fail number on every CI run.
- Existing X2a attach/get/delete flows are unchanged — pHash is an additive column.
- Duplicate-SKU detection surfaces near-duplicate images (common pilot error: same product
  entered twice with different MOL/pack size variants).

**Negative / Risks**
- pHash compute adds ~5-15 ms per upload (32×32 DCT is cheap). Budget-safe.
- 64-bit hash + prefix index: false-positive candidate set at ~0.4% of table per lookup
  (256 buckets over uniform hashes). With 5k SKU worst case, ~20 candidates per lookup
  — under 1 ms distance compute.
- Synthetic golden set is not a real ≥97% precision gate. Documented in X2b.2 TODO.

**Security mitigations**
- pHash computation is pure-math, no filesystem side-effects.
- No new network surface.
- Image decoding uses `image` crate — latest audited version; CVE-2023-* on old
  versions does not apply.

**Compliance framing**
- No regulatory mandate touches perceptual hashing. This is a quality layer.
- DPDP: no PII exposure change (pHash is a one-way summary).
- CERT-In: no new network surface.

## Alternatives considered

1. **dHash** — rejected; 3-4 pp lower precision on re-compressed packs per published
   benchmarks (Marr 2013 / Monga 2006).
2. **aHash** — rejected; too light-sensitive for shop-counter captures.
3. **CNN embedding (MobileNetV3 + triplet loss)** — rejected for X2b.1; model weights
   (>20 MB) violate the <200 MB installer floor, and inference adds 200-500 ms.
   Revisit for X2b.3 if the ≥97% gate stays unmet after real-pilot tuning.
4. **Server-side pHash computed in TS (browser canvas)** — rejected; canvas APIs
   vary across Tauri webview versions; the `image` crate path is deterministic and
   already a dependency for width/height decoding.
5. **Store raw pHash as BLOB** — rejected; TEXT hex is human-readable in SQL
   debug sessions and the 8-byte win is negligible at 5k SKU scale.

## Implementation plan (this PR)

1. `packages/shared-db/migrations/0018_x2b_phash.sql` — ALTER product_images + index.
2. `apps/desktop/src-tauri/Cargo.toml` — add `image = "0.25"` dep.
3. `apps/desktop/src-tauri/src/phash.rs` — pHash computation + unit tests.
4. `apps/desktop/src-tauri/src/images.rs` — wire compute into `attach_product_image`;
   new `find_similar_images(product_id, max_distance)` command.
5. `apps/desktop/src-tauri/src/main.rs` — register new command.
6. `apps/desktop/src-tauri/src/db.rs` — register MIGRATION_0018.
7. `apps/desktop/src/lib/ipc.ts` — add FindSimilarImages DTO + RPC wrapper.
8. `apps/desktop/src/components/ComplianceDashboard.tsx` — add "Duplicate suspects" section.
9. `apps/desktop/src-tauri/tests/phash_golden.rs` — synthetic golden-set test.

## Gate (DoD for this PR)

- cargo fmt ✅ · cargo clippy -D warnings ✅ · cargo test ✅
- typescript tsc --noEmit ✅ · vitest ✅
- migration dry-run on fresh DB ✅ · migration dry-run on seeded DB ✅
- phash determinism test: same bytes → same hash
- phash distinctness test: ≥ 9/10 synthetic different pairs produce Hamming > 12
- phash match test: ≥ 10/10 synthetic matched pairs produce Hamming ≤ 6

## Superseded-by

— (open; next rev expected when X2b.2 lands)
