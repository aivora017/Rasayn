# ADR-0001: X1 Moat — Gmail Distributor Inbox → Prefilled GRN

- Status: **Proposed**
- Date: 2026-04-15
- Deciders: Sourav Shaw (founder), future tech lead
- Playbook ref: v2.0 §4 (X1 moat), §8.1 (locked stack)

## Context

Legacy pharmacy software (Marg, Tally, Retailgraph) forces manual entry of
every distributor invoice. A mid-size shop receives 15–60 distributor bills
per week across 5–12 suppliers. Entry takes 3–8 min per bill, error-prone,
and is the single biggest daily time-sink for the owner.

Most distributors email invoices as PDF / XLSX / CSV attachments to a
consistent owner inbox. The bill header (supplier GSTIN, invoice no, date,
total) and line items (product name, batch, HSN, qty, rate, GST, MRP) are
present in the attachment; only OCR/parse cost separates them from a GRN.

## Decision

Build a Gmail-connected "Distributor Inbox" in the desktop app that:

1. **OAuth-connects** to the shop owner's Gmail via Google-issued OAuth 2.0
   (installed-app flow, refresh token stored in OS keychain via
   `@tauri-apps/plugin-keyring`).
2. **Scans** `from:` senders on a user-managed allowlist (or a learned list
   of frequent supplier domains) for attachments matching `*.pdf|*.xlsx|*.csv`.
3. **Classifies + parses** each attachment via a 3-tier strategy:
   - Tier A: deterministic parser when supplier template is known (per-supplier
     YAML regex + column map). ~60% volume, 99%+ accuracy.
   - Tier B: LayoutLMv3 / Donut header-detect + TrOCR line-extract fallback.
     Edge model, runs on the shop PC. ~30% volume, 92%+ line recall.
   - Tier C: cloud LLM parse (Claude 3.5 via LiteLLM) when local model
     confidence < 0.8. ~10% volume, user-gated, always shown as "suggested".
4. **Matches** parsed lines to local products via SKU/HSN/name fuzzy match.
   Unmatched lines prompt the user to create a product OR skip the line.
5. **Presents** a prefilled GRN in the existing `GrnScreen` with confidence
   indicators per line. User reviews → edits → saves via existing `save_grn`.

### Locked choices

- Gmail only for v1. Outlook/POP deferred.
- OAuth installed-app flow (no cloud relay). Token in OS keychain.
- Edge models (Tier B) run via ONNX Runtime in a sidecar Rust binary.
- LiteLLM handles Tier C routing/billing. User opt-in per shop.
- No PII/attachments leave the LAN in Tier A or Tier B paths.

## Consequences

**Positive**
- Owner saves ~2–5 hrs/week. Moat: legacy vendors cannot ship this without
  rewriting their stack on modern ML + cloud infra (3+ year lead).
- Becomes the default daily entry point for the owner — sticky surface.
- Enables downstream features: auto-PO-match, supplier price drift alerts,
  "this SKU cheaper at X" cross-shop benchmarks.

**Negative / Risk**
- Gmail OAuth requires Google Cloud project + CASA Tier-2 audit before
  >100 users (budgeted; Leviathan Security engaged per §3).
- Edge model size: LayoutLMv3-base is ~450MB. Must gate behind optional
  "AI Pack" install; base installer stays <200MB.
- Cloud LLM cost: ~₹0.40–₹1.20 per bill for Tier C. Passed through at
  AMC-tier or metered.
- Non-determinism: every AI path must have a "manual fallback" button that
  opens an empty `GrnScreen`.

## Alternatives considered

1. **Upload-file-from-disk only** — simpler, no OAuth, but misses the
   "inbox as workflow" sticky surface. Rejected: moat too shallow.
2. **WhatsApp Business distributor bots** — high engagement but fragmented
   (each supplier would need to opt in); deferred to v2.
3. **Direct distributor API integration** — ideal long-term, but <3% of
   Indian pharma distributors expose APIs today. Deferred.

## Rollout plan

- Phase 1 (M0–M1): Tier A only, manual supplier-template editor. Ship to
  Vaidyanath Pharmacy pilot. Target: 5 templates covering ≥80% of their
  inbox volume.
- Phase 2 (M2–M4): Tier B edge model. Gate behind "AI Pack" installer flag.
- Phase 3 (M5+): Tier C cloud fallback, opt-in, metered.

## Supersedes / Superseded-by

- Supersedes: nothing (first ADR on this moat).
- Superseded-by: —
