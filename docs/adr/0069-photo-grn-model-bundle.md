# ADR 0069 — Photo-GRN model bundle + Tier-B decision (X3 v3)

**Date:** 2026-05-05
**Status:** ACCEPTED
**Decider:** Sourav Shaw, founder
**Authority rank:** Rank-3 (below Playbook v2.0 and the Design North Star).

**Extends:** ADR-0068 (Tier-B/C orchestrator stubs).
**Relates to:** Playbook v2.0 §4 X3 moat; Playbook v2.0 §12 hard rules
(every AI feature has a non-AI fallback; every AI vendor has a backup plan).
**Supersedes:** —

---

## Context

ADR-0068 landed the pluggable A→B→C orchestrator and locked the
`PhotoGrnTier` trait, but Tier-B has been returning
`Err("Tier-B model bundle not yet shipped …")` since S23a. The X3
moat — "just photo the bill, we'll do the rest" — therefore still
collapses on the 15% of bills Tier-A regex cannot parse (scanned,
hand-annotated, phone-photographed). Downstream UI is already
rendering `tier_used` chips against the stable trait, so the
orchestrator wiring is solid; the moat is dormant only because no
model is loadable.

S24.3 is the first sprint where (a) the orchestrator is stable,
(b) the perf harness from ADR-0067 can measure inference latency
against the §10 GA budgets, and (c) we have enough pilot photo
samples to scope a fine-tuning corpus. Time to pick the model and
ship the bundle scaffolding.

## Decision — pick LayoutLMv3 over Donut

| Criterion | LayoutLMv3 | Donut | Winner |
|---|---|---|---|
| ONNX export quality | Mature (HF `onnx-runtime` path, multiple production refs) | Beta, OCR-free architecture quirks under ONNX | LayoutLMv3 |
| Bundle size | ~440 MB base (fp16) | ~750 MB | LayoutLMv3 |
| Indian-invoice fine-tuning corpus | FUNSD + CORD baselines + we add 200 distributor invoices in S24-S26 | None public for pharma; cold-start fine-tune | LayoutLMv3 (we control fine-tune) |
| Inference RAM on i3-8100 / 4 GB rig | ~600 MB peak (int8 quant later) | ~1.1 GB peak | LayoutLMv3 |

**Choice:** LayoutLMv3-base, fine-tuned on a 200-invoice golden
set we collect during pilots S24-S26 (Jagannath Pharmacy Kalyan +
two Mumbai pilots). int8 quantisation deferred to S26.

## Bundle layout

Path: `apps/desktop/src-tauri/models/photo_grn/tier_b/`

| File | Purpose | Committed? |
|---|---|---|
| `manifest.json` | model_id, version, sha256, expected_input_shape, label_map, license | yes |
| `model.onnx` | the actual weights (~440 MB) | **no** — gitignored, distributed via signed S3 download bundled into the installer |
| `tokenizer.json` | HF tokenizer config; small | yes (placeholder in S24, real config in S25) |
| `README.md` | provenance, regen steps, hash verification | yes |
| `.gitignore` | ignores `model.onnx` and `*.bin` | yes |

The `manifest.json` is the source of truth at runtime; the loader
reads it first and then verifies `model.onnx` matches the recorded
sha256 before handing the bytes to `ort::Session::builder()`.

## Migration 0045_photo_grn_models.sql

Adds `photo_grn_models(id PK, tier, version, sha256, file_path,
loaded_at, status)` with a tier+status index. Persists which bundle
is currently active so a future "swap models" UI does not need to
walk the filesystem on every boot. Status enum: `active` /
`inactive` / `revoked` (revoked = signed bundle was rotated due to
an accuracy regression and must not be loaded again).

## Cargo feature flag — `tier-b-onnx`

Default builds **omit** the ONNX runtime entirely. Rationale:

- CI stays fast (ort pulls a 100 MB+ native lib chain on Linux).
- Dev rigs without the 440 MB bundle don't need the runtime either.
- The installer build profile enables `tier-b-onnx` so production
  ships with the runtime + bundle wired together.

```toml
[features]
tier-b-onnx = ["dep:ort"]

[dependencies]
ort = { version = "2", optional = true, default-features = false }
```

## Fallback chain (per Playbook §12)

Without the bundle (the dev-default and any installer where the
signed download failed):

1. Tier-A returns `Ok(vec![])` (regex bridge still blocked, see
   ADR-0068 §S23a stub behaviour and the TODO in
   `photo_grn_tiers.rs`).
2. Tier-B returns
   `Err("Tier-B model bundle absent — install signed bundle from <url> per ADR-0069")`
   when the feature flag is on but `model.onnx` is missing, **or**
   `Err("Tier-B compiled without ONNX feature flag (rebuild with --features tier-b-onnx and install model bundle per ADR-0069)")`
   when the flag is off entirely.
3. Tier-C still placeholder (S25).
4. Orchestrator returns `tier_used = "none"`.
5. UI surfaces: *"Tier-A miss, no model loaded — please re-photograph or enter manually."*

That last step is the **non-AI fallback**: manual entry is always
available; the moat degrades gracefully to legacy behaviour.

## Second-vendor plan (per Playbook §12)

If the HuggingFace LayoutLMv3 path stalls (license change, ONNX
export breakage, accuracy plateau), we swap to **Donut** on the
same `PhotoGrnTier` trait. `TierBExtractor` is a single struct,
not a trait family, so the swap is a one-file diff: rebuild the
bundle, replace the loader internals, keep the trait + manifest
schema. No call-site churn.

## Consequences

### Positive
- Moat moves from dormant to "loadable when the bundle is present".
- Feature flag keeps default builds + CI fast.
- Migration 0045 gives us a real registry to point at instead of
  filesystem-walking heuristics.
- Second-vendor plan is concrete (Donut), not handwavy.

### Negative
- Installer size grows by ~440 MB once the signed bundle ships.
  Acceptable: Playbook §3 hardware floor is "<200 MB **base**
  binary"; the model bundle is a separate signed download per
  Playbook §8.7 (already amended for ADR-0024).
- Inference latency 600-1200 ms p95 on the i3-8100 reference rig.
  Acceptable because GRN is a non-blocking workflow — the
  pharmacist photos the bill and continues serving the next
  customer; the parsed draft surfaces a few seconds later.
- Accuracy gate ≥92% line-recall@3 (per Playbook §4 X3 thresholds)
  is not measured here — that is S25 against the golden set.

### Neutral
- `ort` is a real native dep; Windows builds will need the
  bundled DLLs alongside the EXE. Tauri's resource-bundling
  already handles this; no new install-side wiring.

## Alternatives considered

1. **Donut.** Rejected per the criteria table — larger, less
   mature ONNX path, cold-start fine-tune cost.
2. **TrOCR-only.** Rejected — TrOCR returns plain text without
   layout coordinates, so we cannot infer columns (qty / MRP /
   batch) reliably. Tier-A regex would still have to do the
   layout work, defeating the point.
3. **Pure vision-LLM for Tier-B.** Rejected — that is exactly
   Tier-C's role. Tier-B must be deterministic, on-device, and
   measurable, so a frontier-model API does not fit.
4. **Defer Tier-B entirely to S25.** Rejected — leaves the moat
   dormant for another full sprint while pilots are running.
   Landing the bundle scaffolding now lets S25 focus on
   fine-tuning, not plumbing.

## Open questions (resolve before S25 GA)

1. **Golden-set collection.** S24-S26 across three pilot shops;
   target 200 distinct distributor invoices, balanced across
   scanned / hand-annotated / phone-photographed.
2. **Signed-bundle CDN.** S25. Likely Cloudflare R2 + a tiny
   manifest server that returns the current `sha256` so the
   installer can verify before download.
3. **Confidence-threshold tuning.** ADR-0068 locked ≥0.6 average
   as the acceptance gate; real numbers from the golden set in
   S25 may move it.
