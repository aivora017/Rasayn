# Tier-B model bundle (LayoutLMv3 fine-tuned for Indian pharma invoices)

This directory holds the runtime artefacts for the X3 Tier-B extractor.
See **ADR-0069** (`docs/adr/0069-photo-grn-model-bundle.md`) for the
decision context, and **ADR-0068** for the orchestrator that calls
into this bundle.

## What lives here

| File | Purpose | In git? |
|---|---|---|
| `manifest.json` | model_id, version, expected sha256, input shape, label_map, license | yes |
| `tokenizer.json` | HuggingFace tokenizer config | yes (placeholder until S25) |
| `model.onnx` | the actual fine-tuned weights (~440 MB) | **no** — gitignored |
| `.gitignore` | locks `model.onnx` and `*.bin` out of git | yes |
| `README.md` | this file | yes |

## Why `model.onnx` is not in git

The fine-tuned weights are large (~440 MB) and are distributed via a
**signed S3 download** baked into the production installer build. The
dev tree intentionally ships without them, which means:

1. `git clone` stays fast — no LFS, no pre-download step for new devs.
2. Default `cargo build` (without the `tier-b-onnx` feature flag)
   does not even pull the `ort` runtime, let alone the weights.
3. The Tier-B extractor's *absence* path is exercised by every dev
   build — which is exactly the non-AI fallback chain Playbook §12
   requires.

## How to obtain `model.onnx` (S25 onwards)

1. Download from the signed bundle CDN — placeholder URL until S25
   wires the real manifest server:

   ```
   https://cdn.pharmacare.invalid/bundles/photo_grn/tier_b/<version>/model.onnx
   ```

2. Verify the sha256 against `manifest.json`:

   ```sh
   sha256sum -c <(jq -r '"\(.sha256)  model.onnx"' manifest.json)
   ```

3. Drop the verified file alongside this README. The Tier-B loader
   re-verifies the hash at runtime before handing bytes to
   `ort::Session::builder()` — a mismatch is treated as an absent
   bundle and triggers the ADR-0069 fallback chain.

## How the bundle is regenerated

Out of scope for this README; tracked separately under
`scripts/ml/photo_grn/` (added in S25). The short version:

1. Pull `microsoft/layoutlmv3-base` from HuggingFace.
2. Fine-tune on the 200-invoice golden set (S24-S26 collection).
3. Export to ONNX via `optimum-cli export onnx ...`.
4. Sign + upload to the bundle CDN; record the sha256 in
   `manifest.json` and bump `version`.

## Absent-bundle behaviour

When `model.onnx` is missing (the dev default), the Tier-B
extractor returns a graceful `Err` per ADR-0069:

> "Tier-B model bundle absent at <path> — install signed bundle per
> ADR-0069"

The orchestrator then falls through to Tier-C (still a stub in S24)
and finally to `tier_used = "none"`, at which point the desktop UI
prompts the operator to re-photograph or enter the bill manually.
That manual path is the non-AI fallback Playbook §12 mandates.
