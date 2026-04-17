# ADR 0017 — A12: E-invoice IRN (Cygnet primary, ClearTax secondary)

**Status:** Accepted — 2026-04-17
**Supersedes:** — (new)
**Superseded by:** —
**Relates to:** ADR 0014 (A9 invoice-print — IRN/QR printed on A5), ADR 0015 (A10 GSTR-1 — filed_period auto-set), Playbook v2.0 §8.1 (Cygnet = locked GSP vendor), §12 (every integration has a second vendor).

---

## Context

**GSTN mandate:** E-invoice (IRN + QR) is mandatory for B2B supplies by any registered taxpayer with aggregate annual turnover > **₹5 Cr** (threshold as of 2026-04-17 per CGST Notification; we persist both threshold + enabled flag per-shop to absorb future cutovers).

**What we need to ship:**
1. Build an IRN payload from a saved B2B bill (schema 1.1).
2. Submit to GSTN via a registered GSP (Cygnet per §8.1). Parse IRN + AckNo + AckDate + SignedInvoice + QR.
3. Persist to `irn_records` + denormalise onto `bills` for print-time access.
4. Cancel within 24h if requested (GSTN rule; only for certain reasons).
5. Retry on failure with exponential back-off; offline queue for LAN-down scenarios.
6. Print IRN + QR on A5 GST invoice layout (A9 renderer pulls from bill fields).
7. UI surfaces: chip on BillingScreen after save; IRN tab in ReturnsScreen.

**Hard constraints inherited from Playbook:**
- LAN-first: the POS must save + print the bill immediately; IRN submission is async.
- Compliance automatic: turnover gate enforced in code, never a shop toggle that silently bypasses GSTN.
- No vendor lock-in: second-vendor plan is mandatory per §12.
- PII/Rx never leaves the shop LAN without per-feature opt-in — IRN submission **is** that opt-in (explicit shop setting `einvoice_enabled`).

## Decision

### 1. Vendor plan — Cygnet primary, ClearTax secondary

| | Cygnet (primary) | ClearTax (secondary) |
|---|---|---|
| Role | Default GSP for all pilots | Fallback + redundancy |
| Contract | Playbook §8.1 locked | Pre-seed-funded parallel agreement |
| API shape | REST/JSON over TLS | REST/JSON over TLS |
| Adapter | `CygnetAdapter` impl of `EinvoiceAdapter` trait | `ClearTaxAdapter` impl of same trait |
| Switch | Per-shop setting `einvoice_vendor` = `'cygnet' | 'cleartax'` | Owner toggles in F5 Settings |
| Cutover plan | Feature flag + dry-run against shadow vendor before flip | — |

**Adapter trait (Rust):**
```rust
trait EinvoiceAdapter: Send + Sync {
    fn submit(&self, payload: &IrnPayload) -> Result<IrnResponse, AdapterError>;
    fn cancel(&self, irn: &str, reason: CancelReason, remarks: &str) -> Result<CancelResponse, AdapterError>;
    fn vendor_name(&self) -> &'static str;
}
```

### 2. Payload schema — GSTN NIC e-invoice 1.1

Locked fields (subset — full 1.1 schema in `packages/einvoice/src/types.ts`):
- `Version: "1.1"`
- `TranDtls { TaxSch: "GST", SupTyp: "B2B", RegRev?: "Y", IgstOnIntra?: "N" }`
- `DocDtls { Typ: "INV", No, Dt (DD/MM/YYYY IST) }`
- `SellerDtls { Gstin, LglNm, Addr1, Loc, Pin, Stcd }`
- `BuyerDtls { Gstin, LglNm, Pos, Addr1, Loc, Pin, Stcd }`
- `ItemList[] { SlNo, PrdDesc, IsServc: "N", HsnCd, Qty, Unit, UnitPrice, TotAmt, Discount, AssAmt, GstRt, IgstAmt|CgstAmt+SgstAmt, TotItemVal }`
- `ValDtls { AssVal, CgstVal, SgstVal, IgstVal, TotInvVal, RndOffAmt }`

All monetary values are **rupees with 2 decimals** at the IRN boundary (GSTN requirement). Internally we stay in paise; conversion happens at payload-build only. Precision rule: half-away-from-zero (matches A4 CGST-absorb-odd-paisa policy; cross-checked).

### 3. Storage — migration 0016

Three mutations:

**a) `irn_records`** — one row per submission attempt-lineage (not per attempt). Status monotonic: `pending → submitted → acked` OR `pending → failed` OR `acked → cancelled`. Retry creates a NEW row with the prior one left in `failed`. Cancel mutates the same `acked` row → `cancelled`.

**b) `bills`** — ADD `irn TEXT NULL`, `ack_no TEXT NULL`, `ack_date TEXT NULL`, `qr_code TEXT NULL`, `einvoice_status TEXT CHECK IN (NULL,'n/a','pending','submitted','acked','cancelled','failed')`. Denormalised for print-time use + GSTR-1 reconciliation.

**c) `shops`** — ADD `annual_turnover_paise INTEGER DEFAULT 0`, `einvoice_enabled INTEGER NOT NULL DEFAULT 0 CHECK IN (0,1)`, `einvoice_vendor TEXT DEFAULT 'cygnet' CHECK IN ('cygnet','cleartax')`, `einvoice_api_key_enc TEXT NULL` (encrypted; wrapper in packages/crypto).

Triggers:
- `trg_irn_records_append_attempt_count` — `attempt_count` only increments, never decrements.
- `trg_irn_records_status_transition` — enforce the monotonic graph above.
- `trg_bills_einvoice_status_sync` — keep `bills.einvoice_status` = latest `irn_records.status` for that bill (defense-in-depth; Rust also updates explicitly).

### 4. Turnover gate — automatic, not a manual toggle

Gate at 3 layers:
1. **UI:** BillingScreen hides the IRN chip unless `shop.einvoice_enabled = 1 AND shop.annual_turnover_paise > 5_00_00_000_00` (₹5 Cr in paise, i64).
2. **TS `@pharmacare/einvoice`:** `validateBillForIrn` returns error `TURNOVER_BELOW_THRESHOLD` and `EINVOICE_DISABLED` when respective preconditions fail.
3. **Rust `submit_irn`:** re-reads shop row from DB, re-checks; rejects with `"TURNOVER_BELOW_THRESHOLD"`.

When turnover is below: `bills.einvoice_status = 'n/a'` is set on save (no action needed, feature invisible).

### 5. Offline / retry semantics

LAN down or GSTN outage — bill **still saves + prints** (this is LAN-first non-negotiable). IRN flow:
- On `save_bill` success: if B2B + threshold met → insert `irn_records(status='pending')` atomically.
- Async worker: background Tauri task polls `pending` + `failed` (retryable) every 30s, max 5 attempts, exponential back-off 30s/60s/120s/300s/900s.
- On final failure: status=`failed`, surfaced in BillingScreen chip red + Returns screen filter.
- Owner can manually retry from Returns IRN tab.
- Cancel window: 24h from `ack_date`; UI disables cancel button past that.

### 6. UI placement

- **BillingScreen:** IRN chip appears after save when applicable. States: `pending` (blue spinner), `acked` (green + copy icon for IRN), `failed` (red + retry button), `cancelled` (grey), `n/a` (hidden). No new F-key (Alt+digit exhausted post-A11; we piggyback on the saved-bill action surface).
- **ReturnsScreen:** new tab `IRN` alongside GSTR-1 preview tabs. Filterable table of `irn_records` with Retry / Cancel actions per row. Owner-gated for Cancel.
- **A9 renderer:** `@pharmacare/invoice-print` reads `bill.irn`, `bill.qr_code`, renders QR as inline SVG in A5 layout header block; thermal layout gets IRN-tail (short form) only.

### 7. Security / keys

- `einvoice_api_key_enc` stored encrypted via `packages/crypto` AES-256-GCM wrapper; KDF from owner PIN (existing A13 pattern).
- API key never logged. Redacted in all error messages.
- CERT-In: log every submit/cancel attempt with `actor_user_id` + timestamp in a new `einvoice_audit` table (added in this migration as well).

### 8. Testing

- Pure TS package: ≥25 tests covering payload-build happy-path, turnover gate, GSTIN validation, HSN normalise, paise-to-rupee precision (half-away-from-zero), invoice-num format, total cross-check, empty-line rejection, inter-state IGST vs intra CGST+SGST split.
- Rust: adapter trait + **MockAdapter** (deterministic responses) + unit tests for status transitions, retry back-off schedule, turnover re-check.
- Integration: `bill-repo` round-trip `save_bill → submit_irn(mock) → readBillFull → rendered A5 has QR`.
- End-to-end: 1 BillingScreen test (save B2B bill → chip appears → retry on failure → success).

## Consequences

**Positive:**
- Compliance moat deepens (A7 Rx, A13 expiry, A10 GSTR-1, A12 IRN — four auto-compliance gates).
- Second-vendor plan locks in resilience without upfront switch cost.
- Offline queue preserves LAN-first guarantee.

**Negative / accepted:**
- Cygnet API contract not yet signed — `CygnetAdapter` ships as a stub with clearly documented shape; real impl lands when contract closes. `MockAdapter` is what our tests + demo pilots use until then. **This is feature-flagged off until contract signs.**
- QR rendering in thermal layout is short-form IRN text only (64-col width can't fit the full QR matrix readable to phones). Acceptable per GSTN spec — QR is mandatory on A5/A4 only.
- Adding 3 cols to `bills` bloats row size; Indexed scan perf test re-measures post-migration.

## Alternatives considered

1. **In-house GSP registration.** Rejected — 6-9 month GSTN certification blocks MVP; perpetual-license ICP doesn't justify.
2. **ClearTax primary, Cygnet secondary.** Rejected — Playbook §8.1 already locks Cygnet as primary; cost/performance parity in 2026 benchmarks; flipping primary needs a new ADR.
3. **Skip IRN until turnover threshold hits a pilot shop.** Rejected — five of ten target pilots cross ₹5Cr; shipping compliance late would repeat Marg's mistake.
4. **Synchronous IRN at save_bill.** Rejected — violates Hard Rule 1 (LAN-first); GSTN outage would block billing.
5. **Store QR as PNG blob.** Rejected — `qr_code` holds the signed payload string; renderer generates SVG from it at print time (zero storage bloat, zero extra crate).

## Rollback plan

- Feature flag: `shops.einvoice_enabled = 0` globally disables the feature.
- Migration 0016 is additive — all new cols nullable or defaulted. Rollback = `einvoice_enabled = 0` + ignore the cols.
- Schema `DROP` not needed; A12 is safe to disable live.

