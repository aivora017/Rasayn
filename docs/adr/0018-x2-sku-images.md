# ADR 0018 — X2 mandatory SKU images (storage + compliance gate)

**Status**: Accepted · 2026-04-17  
**Scope**: X2a only (this ADR). X2b perceptual-match deferred.  
**Supersedes**: none. Extends Playbook v2.0 §4 (Three Moats → X2).

## Context

X2 is one of the three moats — mandatory product images for every SKU, hard-enforced
for Schedule H/H1/X. Two business outcomes:

1. **Compliance**: owner and pharmacist can visually verify a prescription-only drug
   matches the pack before billing. Reduces dispensing-error liability.
2. **Search UX**: customer-app / POS list views render pack thumbnails — measurably
   faster lookup than name-only lists.

Migration 0001 (§products) already carries an `image_sha256` column and two triggers
(`trg_products_schedule_img_ins`, `trg_products_schedule_img_upd`) that RAISE(ABORT)
on Schedule H/H1/X products with NULL or empty `image_sha256`. What's missing:

- The actual image bytes are not stored anywhere.
- There is no audit trail of attach/replace/delete actions.
- There is no UI to upload / preview / validate.
- There is no compliance dashboard surfacing missing-image violations.

X2 is advertised in Playbook §4 as "match precision ≥97% golden set" — that is the
perceptual / pHash objective (X2b). X2a ships the **storage + gate** layer first;
X2b bolts on the matcher without schema changes.

## Decision

### X2a (shipping in this PR)

1. **Single canonical image per product**, byte-exact identity (SHA256).
   No variants, no compression pipeline — owner uploads one clean pack shot.

2. **BLOB in SQLite** (table `product_images`), not filesystem.
   Rationale: Hard Rule 1 (LAN-first, desktop-first). A single DB file keeps backups,
   DR, and the bundle story trivial. Hard Rule 7 hardware floor (2GB RAM, HDD,
   installer <200MB) is unaffected because images live in the data dir, not the
   installer; cap of 2 MiB/image × 5k SKU worst-case ≈ 10 GB sits fine on the shop's
   data disk.

3. **Size cap 2 MiB, MIME whitelist {image/png, image/jpeg, image/webp}**,
   enforced by SQLite `CHECK` at write time AND server-side magic-byte sniff at the
   Rust command layer (defense in depth — never trust the browser-reported MIME).

4. **Append-only audit** (`product_image_audit`) with BEFORE UPDATE / BEFORE DELETE
   triggers that `RAISE(ABORT, 'append-only')`. Every attach/replace/delete writes a
   row with prior/new SHA + actor user id.

5. **Sync triggers** on `product_images` mutate `products.image_sha256`
   (AFTER INSERT/UPDATE/DELETE). The existing Schedule H/H1/X gate from migration 0001
   reads `products.image_sha256`, so the gate keeps working without duplication.

6. **Compliance dashboard** surfaces the missing-image list: Schedule H/H1/X products
   that somehow bypassed the trigger (legacy import, manual SQL, etc). Purely read-only.

7. **`@pharmacare/sku-images` package** (pure TypeScript):
   - `hashImage(bytes): Promise<string>` — SHA256 hex via WebCrypto.
   - `sniffMime(bytes): 'image/png' | 'image/jpeg' | 'image/webp' | null`
     — magic-byte check (PNG 8‑byte sig, JPEG SOI, WebP RIFF/WEBP).
   - `validate(file): ValidationResult` — size, mime, dimensions (optional).
   - `exifStrip(bytes)`: **deferred to X2a follow-up** — flagged as TODO, not blocking.

8. **UI (ProductMasterScreen)**: replace the raw `imageSha256` text input (line 337-341)
   with a file picker that hashes client-side, previews the thumbnail, and submits the
   bytes (base64) + hash. `ProductImageThumb` is a shared component usable on
   Billing / Returns / ProductMaster.

### X2b (deferred — separate PR after X2a ships)

- pHash / dHash perceptual matching.
- Golden-set harness for the ≥97% precision gate.
- OCR pack-label match.
- Vendor-supplied master image reconciliation.

X2b gets its own ADR; it does not require schema changes — just a new
`product_images.phash` column via migration 0018 when we get there.

## Consequences

**Positive**
- Schedule H/H1/X gate is now visually enforceable end-to-end (upload → store → serve → render).
- DR story unchanged (single `.db` file still the whole source of truth).
- No filesystem side-effects to manage; no orphaned JPGs to clean up.
- Parallel-safe build: three sub-agents can work on package / Rust / UI concurrently
  because the migration + IPC contract is frozen in this commit.

**Negative / Risks**
- DB size grows. At 2 MiB × 5k SKU = 10 GB worst case. Pilot shops average ~800 SKU
  active → ~1.6 GB. Acceptable.
- VACUUM cost on the data file grows with image blobs. Mitigation: weekly `PRAGMA
  auto_vacuum` / `incremental_vacuum` cron, plus owner-triggered "optimize" in Settings.
- EXIF PII not stripped in X2a. Mitigation: TODO flagged, shipping strip in a
  follow-up X2a.1 before the pilot goes live. Documented in /docs/todos/x2a-exif.md.
- Upload UI needs explicit large-file UX (progress, cancel). Owner-facing, rare flow.

**Security mitigations**
- Magic-byte MIME check server-side (Rust `attach_product_image` command) — the
  browser-reported type is advisory only.
- Hard 2 MiB cap (CHECK constraint) — belt-and-braces with the client validator.
- No writes to arbitrary filesystem paths from Tauri commands (bytes flow
  buffer → DB → buffer; never touch disk outside SQLite).
- Append-only audit via triggers — not just an application-layer convention.

**Compliance framing (§8 guardrails)**
- D&C Act 1940 / Rules 1945 do **not** explicitly mandate SKU images. The X2 gate is
  a best-practice enforcement layer Sourav is adding on top of statutory minimums,
  and the audit trail is evidence for pilot owners during inspections.
- DPDP Act 2023: image bytes are not PII. The EXIF strip (X2a.1) closes the only
  meaningful leak path (GPS in phone-camera shots).
- CERT-In: no new network surface added by X2a. Reporting runbook unchanged.

## Alternatives considered

1. **Filesystem store with DB pointer**. Rejected — breaks single-file DR, orphans
   files on delete, extra code for atomicity. The 10 GB worst-case BLOB scenario is
   acceptable given pilot SKU counts.
2. **Cloud image CDN**. Violates Hard Rule 1 (LAN-first, cloud-optional). Owner
   pilots run on 4G dongles; image fetch latency would blow the <2s billing gate.
3. **Multiple variants per product** (front/back/angle). Rejected for X2a; adds
   taxonomy complexity without clear compliance win. Revisit with X2b if users ask.
4. **Store raw base64 as TEXT**. Rejected — 33% size bloat, no CHECK on mime bytes.
5. **No audit trail**. Rejected — the §8 guardrail explicitly requires evidence for
   Schedule H/H1/X enforcement. Append-only triggers are the cheapest compliant option.

## Implementation plan (this PR)

Scaffolding commit (in this PR, first commit):
- `docs/adr/0018-x2-sku-images.md` — this file.
- `packages/shared-db/migrations/0017_x2_product_images.sql` — tables + triggers.
- `apps/desktop/src-tauri/src/db.rs` — register MIGRATION_0017.

Parallel commits (next, three agents):
- **Agent X (package)**: `packages/sku-images/` — hashImage, sniffMime, validate + vitest golden set.
- **Agent Y (Rust)**: `apps/desktop/src-tauri/src/images.rs` — commands attach/get/delete/list_missing + IPC wiring in main.rs + commands.rs.
- **Agent Z (UI)**: `ProductMasterScreen.tsx` file picker, new `ProductImageThumb.tsx` shared component, `ComplianceDashboard.tsx` missing-image surface.

## Gate (DoD for this PR)

- cargo fmt ✅ · cargo clippy -D warnings ✅ · cargo test ✅
- typescript tsc --noEmit ✅ · vitest ✅
- migration dry-run on fresh DB ✅ · migration dry-run on seeded DB ✅
- Schedule H/H1/X manual test: upload → visible thumbnail → replace → audit row → delete blocked for H
- Compliance dashboard shows expected empty state after upload

## Superseded-by

— (open)
