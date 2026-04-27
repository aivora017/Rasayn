# ADR 0024 — X3 Photo-of-Paper-Bill → GRN

> **STATUS: DRAFT** (2026-04-27)
>
> Scoping ADR for the third X-feature moat. Implementation deferred to a
> dedicated sprint; this doc locks the scope, the Tier-A→B→C model layout,
> the accuracy gates, and the package scaffold so the eventual implementation
> sprint has a north-star to execute against.

**Status:** DRAFT
**Date:** 2026-04-27
**Supersedes:** —
**Superseded by:** —
**Relates to:**
- ADR 0001 / 0020 (X1 — Gmail → GRN, Tier-A regex template parser)
- ADR 0018 / 0019 / 0022 (X2 — SKU images + pHash dedupe + inline similar)
- Playbook v2.0 §3 (X-features as legacy-vendor moats), §8.1 (locked tech: 3-tier AI stack)
- Pilot Day-1 SOP §App-A (paper-only shop fallback noted as "manual entry until ADR-0024 ships")

---

## Context

### What X3 unlocks
The X1 Gmail-bridge moat assumes the supplier emails a digital invoice to the
shop owner. **Reality:** ~30-40% of the Tier-1 ICP (independent pharmacies in
Mumbai/Pune/Nashik/Ahmedabad/Bengaluru) receive **paper bills** from
distributors — printed, hand-signed, taped to the box. Marg/Tally/BUSY all
require manual line-by-line re-entry; for a 30-line wholesale GRN this takes
a competent operator 8-12 minutes.

X3 closes that gap: **owner takes a phone photo of the paper bill, hands the
phone to the shop laptop's PharmaCare app, gets a draft GRN ready to review
in <30 seconds.** It's the same hand-off as X1, but the input is a smartphone
photo instead of a Gmail attachment.

### Why this can't be a thin wrapper around an LLM call
Three reasons one-shot "send the photo to a vision LLM" doesn't work:

1. **Accuracy required is too high.** Pharma-bill data has zero tolerance for
   hallucinated quantities or batch numbers — those drive stock and expiry
   alerts. Single-pass vision LLM output today benchmarks at ~78-85% line
   recall on Indian pharma invoice photos (we ran a 50-bill test set in March).
   Below the §10 ≥92% recall@3 gate.
2. **Cost.** Frontier vision LLMs (Claude Opus, GPT-4o vision) charge ~₹10-20
   per high-res photo. At 5 GRNs/day/shop × 100 shops = 500 photos × ₹15 =
   ₹2.25L/month in inference cost. Unaffordable at our pricing tier.
3. **Latency.** Single-pass vision LLM RTT is 8-15s. Pilot owners abandon
   anything >5s.

The fix is the **3-tier model layout** the playbook §8.1 already mandates:
edge → cloud-small → frontier-LLM. Send 95% of bills through tier 1 + 2
(cheap, fast, on-shop), escalate only the 5% that fail confidence to tier 3.

---

## Decision

### 1. Pipeline architecture

Three tiers. Each escalation is gated on per-line confidence, not global.

#### Tier A — On-device OCR (no network)
- **Stack:** Tesseract 5 (LSTM mode) for raw text + LayoutLMv3 fine-tuned
  on 5k Indian pharma bill photos for spatial layout (header / table / total
  zones).
- **Runs:** locally on the Tauri desktop binary via tract-onnx (Rust ONNX
  runtime) for LayoutLMv3 inference. Model size: ~440MB int8-quantized;
  bundled with the installer (gates §8.7 hardware floor — "installer <200MB"
  becomes <650MB; needs amendment).
- **Output:** raw OCR text + bounding-box-tagged regions.
- **Confidence:** geometric — proportion of expected zones detected with
  consistent layout vs the LayoutLMv3 prior.
- **Pass when:** all three of (a) header zone identified, (b) line-table
  bounded box detected, (c) total zone identified. Else escalate.

#### Tier B — Cloud-small layout-aware OCR
- **Stack:** TrOCR (Microsoft, fine-tuned on Indian pharma) hosted on AWS
  ap-south-1 GPU (g5.xlarge spot). Returns structured line-level extraction.
- **Runs:** API call from desktop to PharmaCare cloud-services microservice
  (Go), authenticated via shop's per-instance API key.
- **Latency budget:** 1.5-2.5s.
- **Per-line confidence:** TrOCR returns logits; we threshold at 0.85.
- **Pass when:** ≥92% of detected lines have confidence ≥0.85 AND total
  reconciles within 0.5% of sum(line_total). Else escalate.

#### Tier C — Frontier vision LLM (Claude 3.5 Sonnet)
- **Stack:** Anthropic API; structured output via tools.
- **Runs:** Cloud-services microservice → Anthropic API.
- **Cost:** ~₹15/photo. Acceptable because we expect ≤5% of GRNs to reach
  this tier.
- **Output:** Same `ParsedBill` shape as Tier A/B (uniform downstream).
- **Latency budget:** 4-8s.
- **No further escalation:** Tier C output is taken at face value but every
  line is flagged for **mandatory operator review** in the GrnScreen import
  banner.

### 2. Output shape — uniform `ParsedBill`

Reuses the existing `ParsedBill` type from `@pharmacare/gmail-grn-bridge` so
the downstream auto-match + `pendingGrnDraft` bus flow is identical for X1,
X3, and any future input source.

```ts
interface ParsedBill {
  tier: "A" | "B" | "C";
  header: ParsedHeader;
  lines: readonly ParsedLine[];
}
```

Adds two fields to `ParsedHeader` for X3-specific provenance:

```ts
interface ParsedHeader {
  // ... existing fields ...
  /** Path on disk to the source photo (kept for audit + re-OCR). */
  readonly sourcePhotoPath?: string | null;
  /** Cloud-tier model name when tier ∈ {B,C} for traceability. */
  readonly modelVersion?: string | null;
}
```

### 3. Package layout

New monorepo workspace package `@pharmacare/photo-grn`:

```
packages/photo-grn/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts           # Public API: photoToGrn(input) → ParsedBill
    ├── types.ts           # PhotoInput, TierAResult, TierBResult, etc.
    ├── tierA.ts           # On-device LayoutLMv3 + Tesseract wrapper (calls Rust)
    ├── tierB.ts           # Cloud TrOCR client
    ├── tierC.ts           # Anthropic vision LLM client
    ├── orchestrate.ts     # Confidence-gated escalation chain
    └── *.test.ts          # Per-tier unit tests + golden-set integration
```

Rust side: `apps/desktop/src-tauri/src/photo_grn.rs` for the local
LayoutLMv3 inference + Tesseract bindings. Tauri command:
`photo_grn_extract(photo_path: String) → Result<ParsedBill>`.

### 4. Confidence thresholds (locked)

| Gate | Threshold | What happens below |
|---|---|---|
| Tier A → escalate to B | <90% layout zone match OR no table detected | Send photo to cloud TrOCR |
| Tier B → escalate to C | <92% line-recall confidence OR total mismatch >0.5% | Send to Claude vision |
| Tier C → operator review | (always) | Banner in GrnScreen with "REVIEW EVERY LINE" call-out |

### 5. Accuracy gates (§10 GA condition)

Per playbook §3 X3 acceptance:
- **Line recall@3 ≥92%** measured on a 200-photo golden set captured from
  Jagannath + the next 5 pilot shops. Recall@3 = within top-3 candidate
  product matches.
- **Header field precision ≥85%** for invoice no, date, total, supplier name.
- **End-to-end p95 ≤5s** for Tier A+B path (Tier C is 4-8s and acceptable
  because rare).

### 6. Storage + retention

- Source photos stored in `%APPDATA%\PharmaCarePro\photo-grn\<UTC>\<sha256>.jpg`.
- Photo retained for 30 days post-import, then auto-pruned (configurable via
  `PHARMACARE_PHOTO_GRN_RETENTION_DAYS`, default 30).
- Retention reason: post-hoc audit of any GRN dispute. After 30 days the
  GRN row + parsed JSON suffice (Indian audit trail standard is `bill_lines`
  + supplier copy, not the inbound paper photo).

### 7. Privacy + compliance

- Photo never leaves shop LAN unless tier B/C is invoked.
- For tier B/C, owner consent is captured **once at install** (DPDP §7
  consent registry); the consent UI explicitly notes "this means the photo
  + extracted text travels to PharmaCare cloud". Consent revocable; revoking
  forces all subsequent GRNs to fall back to Tier A only.
- No PII in photos (vendor invoices have shop GSTIN + supplier GSTIN, no
  customer data) — DPDP scope is minimal here, but the consent registry
  treats it as a Sensitive Personal Data category to be safe.

### 8. Failure modes + handling

| Failure | UX surface | Fallback |
|---|---|---|
| All three tiers fail | "Couldn't read this bill — please type it manually" banner with "Open empty GRN draft" button | X1 Tier-A unmatched-row workflow (existing) |
| Tier B/C network outage | Tier A result returned with a warning chip "low confidence — review every line" | Manual review |
| Tier C cost-cap hit (₹50k/month per shop) | Tier B result returned with the cost-cap banner | Owner contacts hotline to raise cap |
| Photo too blurry / too dark | Front-end pre-validation rejects before any tier runs | Owner re-takes photo |

---

## Migration / data model

Schema migration **0023** (X3 photo-grn metadata table):

```sql
CREATE TABLE photo_grns (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  source_path     TEXT NOT NULL,          -- relative to %APPDATA%\PharmaCarePro
  source_sha256   TEXT NOT NULL,          -- dedupe identical re-uploads
  tier            TEXT NOT NULL CHECK (tier IN ('A','B','C')),
  model_version   TEXT,                   -- e.g. 'tesseract-5.3' or 'claude-sonnet-3.5'
  parsed_json     TEXT NOT NULL,          -- ParsedBill snapshot
  resulting_grn   TEXT REFERENCES grns(id) ON DELETE SET NULL,
  consumed_at     TEXT,                   -- when operator turned it into a GRN
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_photo_grns_shop_created ON photo_grns(shop_id, created_at);
```

---

## Compliance

- DPDP Act 2023: consent + data-subject-rights extended to photo bytes.
- CGST §35: GRN is the audit-relevant record. Photos are advisory.
- D&C Rules 1945: paper bill from distributor remains the source of truth;
  X3 is a data-entry assist, not a substitute for the original bill copy.

---

## Alternatives considered

1. **Pure Claude vision (skip Tier A/B).** Rejected — cost + latency budget
   blow-ups detailed in §Context.
2. **Pure on-device (skip Tier B/C).** Rejected — accuracy gate not
   reachable without TrOCR fine-tune; LayoutLMv3 alone is ~78% line recall.
3. **Vendor SDK (Veryfi, AWS Textract).** Rejected — opaque pricing, IP
   contamination risk for a moat feature, no Indian-pharma fine-tune.

---

## Consequences

### Positive
- 30-40% of Tier-1 ICP becomes addressable on Day-1.
- Same `ParsedBill` shape as X1 → no GrnScreen rework.
- Tier-A on-device path keeps the LAN-first promise intact for the 95%
  case.

### Negative
- Installer size grows ~440MB (LayoutLMv3 quantized weights). Playbook §8.7
  installer-size cap needs a §8.7-amendment ADR.
- Cloud cost: ~₹2-3L/month at 100 shops. Bake into pricing as part of AMC.
- Operator UX adds a "review every line" banner for Tier C output —
  must be unmissable but not rage-inducing.

---

## Test strategy

1. **Golden set** — 200 photos from 6 pilots, hand-labelled lines + totals.
2. **Tier-A unit tests** — LayoutLMv3 zone-detection accuracy on 50-photo
   subset.
3. **Tier-B integration tests** — mock TrOCR endpoint; assert escalation
   logic fires on confidence threshold.
4. **Tier-C smoke** — single-photo end-to-end on Anthropic API (gated by
   secret, off in CI by default).
5. **Confidence-cascade test** — mock all three tiers; assert orchestrator
   stops at the first one that clears its threshold.
6. **Cost-cap test** — assert that Tier-C calls fail closed when the
   per-shop monthly budget is exceeded.

---

## Build phases

| Phase | Scope | Effort |
|---|---|---|
| **Phase 1** (this ADR + scaffold) | ADR draft + package shell + Rust `mod photo_grn` stub. **THIS COMMIT.** | ~1 session |
| **Phase 2** | Tier-A + Rust LayoutLMv3 ONNX bundle + Tesseract bindings | ~3 sessions |
| **Phase 3** | Tier-B cloud TrOCR microservice + auth + cost meter | ~2 sessions |
| **Phase 4** | Tier-C Claude vision client + cost cap + consent UI | ~1 session |
| **Phase 5** | Golden-set authoring + accuracy gate enforcement | ~1 session |

Phases 2-5 require the X1 cloud bridge to be online + AWS ap-south-1
infrastructure provisioned. Total: ~8 sessions / 4-6 weeks of single-
engineer effort post-pilot Day-1.

---

## Open questions (resolve before Phase 2)

1. **Tesseract licensing.** Apache-2.0, ships with Tauri binary fine. Confirm.
2. **LayoutLMv3 fine-tune.** Anthropic-built or in-house? In-house favoured —
   IP staying in our repo. Cost: ~₹5-8L for a 5k-photo labelled fine-tune
   contract.
3. **Cost cap per shop.** Default ₹50k/month? Owner-tunable in Settings?
4. **Tier-C consent UX.** One-time at install vs per-import? One-time
   simpler; per-import safer. Lean one-time.
