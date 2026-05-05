# ADR 0070 — Tier-A regex parser lives in TypeScript, not Rust

**Date:** 2026-05-05 · **Status:** ACCEPTED · **Decider:** Sourav Shaw, founder
**Authority rank:** Rank-3 (below Playbook v2.0 and the Design North Star).

**Extends:** ADR-0068 (Photo-GRN Tier-B+C orchestrator), ADR-0069 (Photo-GRN model bundle)
**Relates to:** Playbook v2.0 §4 X3 moat, §12 hard rules
**Supersedes:** —

---

## Context

Sprint S24.4 was scoped to "bridge `TierAExtractor` from its `Ok(vec![])`
placeholder to the existing photo_grn module," based on ADR-0068's claim
that "Tier-A (regex) ships in S15 in `photo_grn.rs`."

That claim is **not what shipped**. Reading the actual code on
`main = 9ca84f5`:

- `apps/desktop/src-tauri/src/photo_grn.rs` is a 96-line Phase-1 stub.
  It accepts a base64 image + `reportedMime` + `shopId`, computes
  `SHA-256` over the bytes, and returns an empty `ParsedBillDto` with
  `requires_operator_review: true`. There is no regex parser, no line
  extractor, no header parser. The file's own header comment says so:
  > "Phase-1 implementation: takes a base64-encoded image + reportedMime
  >  + shopId, computes SHA-256 over the bytes, and returns an empty
  >  ParsedBill stub with requiresOperatorReview=true."
- The **real** Tier-A regex parser lives in TypeScript at
  `packages/photo-grn/src/tierA.ts`, with full unit coverage in
  `tierA.test.ts`. It exports `tierA(rawText: string): TierAOutput`,
  along with `RE_INVOICE_NO`, `RE_INVOICE_DATE`, `RE_GSTIN`,
  `RE_SUPPLIER_HEADER`, `RE_TOTAL`, and `RE_LINE`. It runs over
  pre-OCR'd text, not over raw image bytes.

Two ways to reconcile the orchestrator with reality:

1. **Port `tierA.ts` to Rust.** Duplicates ~200 lines of regex + tests
   into a second language. Two implementations to maintain, two regex
   sets to keep in sync, two test suites to update on every distributor
   format change. Violates the spirit of §12 hard rule "every
   integration has a second-vendor plan" — that rule is about
   *vendors*, not about us shipping our own code twice.
2. **Document Tier-A as a JS-side delegate.** Keep
   `TierAExtractor::extract` returning `Ok(vec![])` *by design*; the
   Rust orchestrator deliberately runs only Tier-B and Tier-C; the
   JS-side caller (`PhotoBillCapture` component, via
   `@pharmacare/photo-grn::photoToGrnFromText`) runs Tier-A
   *upstream* in TypeScript and only invokes the Rust orchestrator
   when Tier-A returns zero lines or low confidence.

(2) matches what already exists. (1) is duplication for symmetry that
nobody asked for.

## Decision

Adopt **Option 2**. Tier-A is a TypeScript-only concern. The Rust
orchestrator's `TierAExtractor` stays a deliberate `Ok(vec![])`
placeholder — its presence in the trait's iteration order
(`A → B → C`) preserves the public shape of `ExtractionResult` (so
downstream UI keeps rendering "tier_used" chips for all three tiers)
without forcing a port.

### End-to-end flow (canonical)

```
┌─────────────────────────┐
│ PhotoBillCapture (TSX)  │   user picks image
└────────────┬────────────┘
             │ image bytes + OCR text from on-device OCR
             ▼
┌─────────────────────────────────────────┐
│ @pharmacare/photo-grn::                 │
│   photoToGrnFromText(rawOcrText)        │   Tier-A (regex, TS)
│   → tierA(rawText) → TierAOutput        │
└────────────┬────────────────────────────┘
             │ if confidence ≥ 0.6 AND ≥1 line: STOP, return.
             │ else escalate via Tauri command:
             ▼
┌─────────────────────────────────────────┐
│ #[tauri::command] photo_grn_run(input)  │
│   → photo_grn_tiers::extract_with_      │
│     fallback(image_path)                │
│       TierAExtractor → Ok(vec![])       │   skip (by design)
│       TierBExtractor → ONNX ▷ ADR-0069  │   Tier-B (LayoutLMv3, Rust)
│       TierCExtractor → vision-LLM       │   Tier-C (cloud, deferred)
└─────────────────────────────────────────┘
```

The `tier_used` field stamped on the result is therefore:

- `"tier_a"` when JS Tier-A succeeds (the Rust orchestrator never sees
  the request — JS short-circuits).
- `"tier_b"` / `"tier_c"` / `"none"` when JS escalates and Rust handles
  the image path.

The Rust orchestrator never returns `tier_used = "tier_a"`. That is
correct: Tier-A is the JS responsibility.

## Consequences

- **Trait stays stable.** No churn to `PhotoGrnTier`,
  `ExtractionResult`, or `extract_with_fallback`. ADR-0068's
  acceptance ladder is preserved verbatim.
- **`TierAExtractor` is a documented placeholder, not a TODO.** The
  inline comment in `apps/desktop/src-tauri/src/photo_grn_tiers.rs`
  changes from `TODO(s24): bridge to existing photo_grn module` to a
  permanent comment pointing to this ADR. The `Ok(vec![])` return is
  the intended behavior.
- **Test coverage stays where it is.** `tierA.test.ts` (TS) covers the
  regex parser. `photo_grn_tiers_test.rs` (Rust) covers the orchestrator
  fall-through, with one new test (`tier_a_returns_empty_by_design`)
  that locks the contract in place so a future agent doesn't try to
  "fix" it again.
- **Documentation alignment.** ADR-0068's "Tier-A ships in S15 in
  photo_grn.rs" line is incorrect; this ADR records the correction.
  Future readers should treat ADR-0068 §"Pluggable trait" as
  describing the trait shape, not the implementation language.
- **Cost:** zero. No code moves. No tests removed. One ADR + one test
  + one comment change.

## Alternatives considered

- **Port `tierA.ts` to Rust.** Rejected. ~200 lines of regex
  duplication, two test suites to keep in sync, no observable benefit:
  Tier-A is already deterministic and fast (<5 ms in TS over
  4 KB of OCR text). The desktop POS runs both Rust and TS in the same
  Tauri process; calling TS from JS is the natural codepath. Adding
  Rust as a second host invites drift.
- **Change the trait signature** so `TierAExtractor::extract` accepts
  pre-OCR'd text instead of `image_path: &str`. Rejected. Would force
  every implementor to declare an `image_path → text` step,
  duplicating Tier-B's OCR responsibility. Cleaner to keep the trait
  image-centric and let the JS layer handle the text-centric Tier-A.
- **Remove `TierAExtractor` from the Rust orchestrator entirely.**
  Rejected. The placeholder preserves the trait's symmetry and lets
  `extract_with_fallback`'s acceptance-ladder code stay uniform. A
  three-tier loop with one tier deliberately empty is simpler than a
  two-tier loop plus a separately-documented "pretend Tier-A ran in TS"
  comment.

## Open questions

- **Should `@pharmacare/photo-grn` and the Rust orchestrator share
  the `ExtractedLine` shape?** Right now the TS side returns
  `ParsedLine` (from `@pharmacare/gmail-inbox`) and the Rust side
  returns `ExtractedLine`. They're structurally compatible but not
  identical. Future S26 cleanup: unify in `@pharmacare/shared-types`.
- **Where does on-device OCR live?** The diagram above shows OCR as
  upstream of `photoToGrnFromText`. Currently that step is mocked.
  S25 lands real OCR (Tesseract.js or platform OCR) — separate ADR.
