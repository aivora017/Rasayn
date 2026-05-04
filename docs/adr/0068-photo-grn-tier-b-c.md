# ADR 0030 — Photo-GRN Tier-B + Tier-C orchestrator (X3 v2)

> **STATUS: ACCEPTED** (2026-05-04, Sprint S23a)
>
> Locks the pluggable orchestrator interface for the X3 photo-of-paper-bill →
> GRN moat. Tier-A is already shipping (regex against Marg/Tally export
> templates, see `apps/desktop/src-tauri/src/photo_grn.rs`). This ADR adds
> the Tier-B (LayoutLMv3 / Donut) and Tier-C (vision-LLM) extension points
> as stubs, so downstream consumers can wire against the stable trait now
> while real model bundles land in S25.

**Status:** ACCEPTED
**Date:** 2026-05-04
**Supersedes:** —
**Superseded by:** —
**Extends:** ADR-0024 (X3 v1, Tier-A regex only)
**Relates to:**
- Playbook v2.0 §4 X3 moat (photo-of-paper-bill → GRN)
- Playbook v2.0 §12 hard rule (every AI feature requires a non-AI fallback)
- ADR-0001 / ADR-0020 (X1 — Gmail → GRN, the sibling moat)

---

## Context

ADR-0024 sketched the three-tier model layout for X3 but only Tier-A
(regex over Marg / Tally / BUSY export-format text) actually shipped in
Sprint S15. Tier-A is fast (<200ms), works fully offline, and clears
~85% of distributor invoices that arrive in the standard printed
export format used by the dominant Indian wholesale-pharmacy ERPs.

That **15% gap is the X3 moat collapsing in pilot**. The bills that
defeat Tier-A regex are:

1. **Scanned paper bills** — small 2-3 distributor shops that print on
   a dot-matrix or a hand-typed letterhead that does not match Marg's
   table layout regex.
2. **Hand-annotated bills** — ink stamps, manual qty corrections,
   margin notes that disrupt column alignment.
3. **Phone-photographed bills** — perspective skew, glare, partial
   crops; OCR pre-processing needed before any regex parser stands a
   chance.

Without B and C, ~15% of GRNs in the Tier-1 ICP fall back to fully
manual entry — which is the legacy-vendor experience PharmaCare is
explicitly displacing. The X3 pitch ("just photo the bill") collapses.

We need the B/C extension points landed **now**, before the model
bundle work, so that:

- The orchestrator interface is **stable from S23a forward** — no
  thrashing of public types when S25 wires real models.
- Downstream UI (PhotoBillCapture in the desktop app) can render
  "tier_a" / "tier_b" / "tier_c" / "none" provenance chips today
  against a real (if stubbed) backend.
- CI gains a regression test for the fallback chain itself, separate
  from the model accuracy gates that S25 will add.

---

## Decision

### Pluggable trait

A single Rust trait, `PhotoGrnTier`, lives in
`apps/desktop/src-tauri/src/photo_grn_tiers.rs`:

```rust
pub trait PhotoGrnTier {
    fn name(&self) -> &'static str;
    fn extract(&self, image_path: &str) -> Result<Vec<ExtractedLine>, String>;
}
```

Three concrete impls — `TierAExtractor`, `TierBExtractor`,
`TierCExtractor` — sit in the same module. Each has a stable
`name()` returning `"tier_a"`, `"tier_b"`, `"tier_c"` respectively
(also the literal stamped onto `ExtractionResult::tier_used`).

### Orchestrator

A free function `extract_with_fallback(image_path: &str) -> ExtractionResult`
runs the tiers in fixed A → B → C order and picks the **first tier
that returns `Ok` with at least one line item**.

Acceptance ladder:

| Step | Tier | Outcome | Action |
|------|------|---------|--------|
| 1 | A | `Ok(lines)` with `lines.len() >= 1` | return `tier_used = "tier_a"` |
| 2 | A | `Ok(vec![])` *or* `Err(_)` | record err (if any), advance to B |
| 3 | B | `Ok(lines)` with `lines.len() >= 1` | return `tier_used = "tier_b"` |
| 4 | B | otherwise | record err, advance to C |
| 5 | C | `Ok(lines)` with `lines.len() >= 1` | return `tier_used = "tier_c"` |
| 6 | C | otherwise | return `tier_used = "none"`, error = most recent |

In S25 the acceptance gate becomes "≥1 line AND average confidence ≥0.6";
the trait already carries `ExtractedLine::confidence`, so no signature
churn when that lands.

The orchestrator **never panics**. Per playbook §12, every AI feature
must have a non-AI fallback; here the fallback is the orchestrator
itself returning a well-formed empty `ExtractionResult` instead of
exploding. The desktop UI surfaces "couldn't read this bill — type it
manually" against `tier_used == "none"`.

### S23a stub behaviour

- **Tier-A** returns `Ok(vec![])` with a `// TODO(s24)` comment. S24
  will bridge it to the existing `photo_grn` Tauri-side regex parser.
  Returning empty (not `Err`) is deliberate: it lets the orchestrator
  exercise the soft-miss → fall-through path end-to-end in tests.
- **Tier-B** returns `Err("Tier-B model bundle not yet shipped (deferred to S25 per ADR-0068)")`.
- **Tier-C** returns `Err("Tier-C vision-LLM not yet wired (deferred to S25 per ADR-0068)")`.

### Privacy + LAN-first

Per ADR-0024 §7 and playbook §2: Tier-A and Tier-B run on-device
(model bundles ship inside the installer). Tier-C — when it lands in
S25 — only fires after explicit DPDP §7 consent and is the only tier
that touches the network. The trait makes no commitment about
network-vs-local; that decision lives inside each impl.

### Tauri surface

`photo_grn_tiers` is registered as `mod photo_grn_tiers;` in
`apps/desktop/src-tauri/src/main.rs` (alphabetic order, immediately
after `mod photo_grn;`). **No `tauri::generate_handler!` entries in
S23a** — the orchestrator stays a private Rust API until S25 wires
real models and a JS-callable command. This keeps the Tauri command
surface (currently 116 commands) unchanged this sprint.

---

## Consequences

### Positive
- Stable orchestrator interface from S23a — UI + tests can target it now.
- Playbook §12 compliance: explicit fallback chain that always returns a
  well-formed result.
- New `tests/photo_grn_tiers_test.rs` adds regression coverage for the
  fallback logic, independent of any model accuracy gate.
- Zero growth in Tauri command surface this sprint.

### Negative
- **Installer-size budget pressure.** The S25 bundles add ~600MB
  (LayoutLMv3-base int8 ≈ 440MB + Donut-base ≈ 160MB). The installer
  cap in playbook §8.7 already had to expand to 650MB for ADR-0024;
  S25 will need to re-amend.
- **CI matrix grows** by one integration test now and a 200-photo
  golden-set acceptance suite in S25. Acceptable.
- **Orchestrator interface is now load-bearing** — any future refactor
  (e.g., async streaming results, partial extractions) needs an ADR
  superseding this one.

### Neutral
- The desktop crate has no `[lib]` target, so the integration test
  reaches the orchestrator via `#[path = "../src/photo_grn_tiers.rs"]
  mod photo_grn_tiers;`. Standard pattern for binary-only Cargo
  crates; called out here so a future reader does not "fix" it.

---

## Alternatives considered

1. **Cloud-only OCR (e.g., Google Document AI, AWS Textract).**
   Rejected — violates §2 LAN-first non-negotiable. ~30% of pilot
   shops in Mumbai/Pune/Nashik report unstable internet at the
   counter; a cloud-only path means no GRN parsing during outages.
   Also: opaque pricing, IP-contamination risk for a moat feature.
2. **Single-tier vision-LLM.** Rejected — slow (8-15s p95) and costly
   (>₹2/bill in API spend at frontier-model rates). At 5 GRNs/day
   ×100 shops = ₹3L/month inference cost, unaffordable at our pricing
   tier. See ADR-0024 §Context for the math.
3. **Ditch X3 entirely.** Rejected — listed as one of three X-feature
   moats in playbook v2.0 §3 (alongside X1 Gmail-bridge and X2 SKU
   images). Removing it removes a third of the legacy-vendor
   differentiator.
4. **Defer the trait + orchestrator to S25 alongside the models.**
   Rejected — couples interface design to model availability. We get
   a shorter, safer S25 by locking the public types now in S23a.
5. **Async / streaming extraction trait.** Rejected for S23a — adds
   tokio + async-trait surface for no current consumer. The
   synchronous trait is upgradable (an async-first variant can be
   added in a successor ADR without breaking the sync trait, by
   blanket-impl).

---

## Test strategy (S23a-only)

Three integration tests in
`apps/desktop/src-tauri/tests/photo_grn_tiers_test.rs`:

1. `orchestrator_falls_through_to_b_when_a_returns_zero_lines` —
   confirms the orchestrator does **not** lock in Tier-A on an empty
   `Ok(vec![])`. With current stubs, the chain ends at `"none"`.
2. `orchestrator_returns_none_when_all_tiers_fail` — confirms
   `tier_used == "none"` and `error` is `Some(_)` carrying the most
   recent (Tier-C) deferral message.
3. `extraction_result_carries_tier_used_field` — pure shape smoke
   test; instantiates `ExtractionResult` + `ExtractedLine` directly
   to lock in field types so future serde wire-format changes break
   the build instead of pilots.

S25 will add the 200-photo golden-set accuracy gate; out of scope here.

---

## Migration

None. New module, new test file, one-line addition to `main.rs`. No
database migration, no schema change, no Tauri command added.

---

## Open questions (resolve before S25)

1. **Model bundle hosting.** Ship inside MSI (installer balloons to ~1.3GB)
   vs first-run download from a CDN (faster install, network dependency at
   first launch). Lean toward bundled — preserves LAN-first first-launch.
2. **Tier-C provider.** Anthropic (Claude 3.5 Sonnet vision) vs
   open-source (Qwen2-VL via local Ollama). Cost/quality table in S25.
3. **Confidence threshold (≥0.6).** Locked at 0.6 here; will need
   recalibration once the golden-set telemetry exists.

