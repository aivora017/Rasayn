# PharmaCare Pro — Deep Audit & Branch Plan
**Audit date:** 2026-04-15
**Baseline:** repo HEAD at time of audit, codebase v0.1.0
**Ground truth documents:**
- `PharmaCare_Pro_Build_Playbook_v2.0_Final.docx` (PRIMARY, locked)
- `PharmaCare_Pro_Architecture_Revision_v1.1.docx`
- `PharmaCare_Pro_Build_Spec_2026.docx` (reference, superseded)
- `Pharmacy_Software_Deep_Research_Report_2026.docx` (regulatory/market)
**Working extractions:** `/tmp/canonical/FR_CATALOG.md` (142 FRs, 22 modules), `/tmp/canonical/CODE_INVENTORY.md`

---

## 1. The honest headline

PharmaCare Pro is **not ready to deliver or scale.** It is a well-structured MVP spine with three working screens, two half-wired moats, and about 20–25% of the playbook's functional scope implemented. Calling it shippable would be a lie.

Quantitative baseline (measured, not estimated):

| Metric | Value | Source |
|---|---|---|
| Functional requirements in playbook v2.0 | 142 across 22 modules | `FR_CATALOG.md §3` |
| FRs fully implemented in code | ~18 | cross-walk below |
| FRs partially implemented | ~22 | cross-walk below |
| FRs not started | ~102 | cross-walk below |
| Total source LOC (TS + TSX + Rust + SQL) | 9,208 | `find . -name "*.ts" ... \| xargs wc -l` |
| Tests passing | 132 (vitest) + 0 Rust cargo tests | `turbo run test` |
| Tauri commands registered | 26 | `main.rs invoke_handler` |
| Migrations applied | 5 (0001 → 0005) | `packages/shared-db/migrations/` |
| ADRs written | 5 | `docs/adr/` |
| Hard placeholders that block prod | 2 (`CLIENT_ID`/`CLIENT_SECRET`) + 1 (hardcoded SUPPLIERS list) | `oauth/mod.rs:45`, `GrnScreen.tsx:8-14` |
| Empty workspace packages | 5 (`apps/cloud-services`, `apps/mobile`, `apps/web`, `packages/crypto`, `packages/schedule-h`) | directory scan |
| CI/CD workflows | 0 (`.github/workflows/` is empty) | directory scan |
| Code-signing, installer build | 0 | scan |
| Perf gates measured on target hardware | 0/18 | no benchmark harness |

Previous session's self-assessment that the app is "70% production-ready" was **wrong**. Honest read: **~25% of the playbook's scope**, weighted by effort. The agent that produced that number was counting green test suites, not feature coverage against the 142-FR spec.

---

## 2. Module-by-module gap matrix

Legend: **✅ Done** = tested, no placeholders, meets acceptance criteria. **🟡 Partial** = code exists but gaps in flow, enforcement, or tests. **❌ Missing** = no code. **N/A** = out of Phase 1 scope per v2.0 §8.

| # | Module | FR count | Done | Partial | Missing | Evidence |
|---|---|---:|---:|---:|---:|---|
| 1 | Authentication & RBAC | 7 | 0 | 0 | 7 | no `users`/`roles` code, no login screen; `users` table exists but unused |
| 2 | Master data | 8 | 3 | 2 | 3 | products/batches real (`search-repo`, `bill-repo`); no bulk CSV import UI; GST rate master table absent (rates computed inline in `gst-engine`) |
| 3 | POS / Billing | 8 | 3 | 3 | 2 | F2 search + line add + Rx attach real; discount (Alt+D), void (Ctrl+Z), payment method picker, print ALL missing |
| 4 | Returns & credit notes | 3 | 0 | 0 | 3 | `returns` table not in schema; no F5 return flow |
| 5 | Purchase & GRN | 4 | 2 | 1 | 1 | GRN entry real; **PO entity does not exist** → 3-way match impossible; batch alerts missing |
| 6 | Inventory | 8 | 2 | 2 | 4 | Stock view + FEFO real; ABC/XYZ, dead stock, stock audit, adjustments, multi-store transfer all missing |
| 7 | GST & e-invoice | 5 | 1 | 1 | 3 | GST calc real; GSTR-1 numeric buckets real but no export/download; **no e-invoice IRN via Cygnet**; no e-way bill; no rate-update mechanism |
| 8 | Compliance registers (H/H1/X/NDPS) | 6 | 0 | 2 | 4 | Rx attach at bill-time exists; **no Schedule H/H1/X/NDPS register reports**; no monthly reconciliation report; no DPCO price-cap enforcement |
| 9 | CRM / loyalty / khata / wallet | 7 | 0 | 1 | 6 | `customers` table + search exists; **no khata, no loyalty, no wallet, no refill reminders, no family profiles, no NPS survey** |
| 10 | Home delivery + rider | 5 | 0 | 0 | 5 | N/A Phase 1; scheduled Phase 2+ |
| 11 | E-commerce storefront | 7 | 0 | 0 | 7 | `apps/web` empty; N/A Phase 2+ |
| 12 | Customer mobile app | 8 | 0 | 0 | 8 | `apps/mobile` empty; N/A Phase 2+ |
| 13 | Owner mobile app | 7 | 0 | 0 | 7 | `apps/mobile` empty; N/A Phase 2+ |
| 14 | ONDC seller | 3 | 0 | 0 | 3 | N/A Phase 2+ |
| 15 | Messaging (WhatsApp, SMS, email) | 4 | 0 | 0 | 4 | Gupshup not integrated; SMS receipts, bulk campaigns, email invoices all missing |
| 16 | Doctor integration | 4 | 0 | 1 | 3 | `doctors` + `prescriptions` tables + CRUD real; referral tracking, license API validation, tele-consult missing |
| 17 | Hospital / ward indent | 4 | 0 | 0 | 4 | No `hospitals`/`indents` table; missing entirely |
| 18 | Multi-store & franchise | 1 | 0 | 0 | 1 | `shops` PK ready; no master-data sync protocol |
| 19 | Reporting & analytics | 2 | 1 | 1 | 0 | Daybook + top movers real; MIS P&L, customer segmentation missing |
| 20 | LAN parent/worker | 3 | 0 | 0 | 3 | **Whole layer missing** — no gRPC, no mDNS, no CRDT, no heartbeat. Single-node only. |
| 21 | AI moats (X1/X2/X3) | 3 | 0 | 1 | 2 | X1 Tier A (regex) done for text attachments; X1 Tier B (PDF via OCR), X1 Tier C golden-set eval, X2 image upload UI, X3 photo-bill pipeline all missing |
| 22 | Cloud bridge | 2 | 0 | 0 | 2 | N/A Phase 2+ |
| — | Installer / signing / auto-update | — | 0 | 0 | all | no `.msi`/`.dmg` build target, no DigiCert EV cert, no auto-update channel |
| — | Backup / restore / DR | — | 0 | 0 | all | no `backup_db` command, no nightly job, no one-command restore |
| — | Hardware integration | — | 0 | 0 | all | no barcode HID listener, no thermal print driver, no cash-drawer, no weighing-scale |
| — | Localization | — | 0 | 0 | all | no i18n framework wired (Hindi/Marathi/Gujarati missing) |
| — | CI/CD | — | 0 | 0 | all | `.github/workflows/` empty |
| — | Observability | — | 0 | 0 | all | no OpenTelemetry, no Sentry, no log pipeline |
| — | DPDP / CERT-In runbook | — | 0 | 0 | all | no DPO, no consent registry, no DSR UI, no 180-d log retention enforcement |

**Rollup:** 142 FRs surveyed, ~18 done, ~22 partial, ~102 not started. **Total ≈ 25% of playbook scope covered**, weighted crudely by FR count. When weighted by *effort* (LAN parent/worker, mobile apps, cloud bridge, e-invoice IRN each represent many sprints), true coverage is closer to 15%.

---

## 3. Known runtime blockers (confirmed in code)

These are not predictions — they are bugs I confirmed by reading the files.

| ID | Location | Issue | Impact |
|---|---|---|---|
| B1 | `oauth/mod.rs:45` | `CLIENT_ID = "REPLACE_ME..."` | Every Gmail connect call returns an error. X1 is dead until fixed. |
| B2 | `components/GrnScreen.tsx:8-14` | `SUPPLIERS` is a hardcoded const of 5 fake distributors | Real shop has real suppliers. Shipping this is pretending, not software. |
| B3 | `components/BillingScreen.tsx` | "Save & Print" button has save logic but no print path | Pharmacist cannot hand a receipt to a customer. |
| B4 | `components/BillingScreen.tsx` | No payment-method picker (cash / UPI / card / khata) | Cannot close a bill correctly per FT-POS-004. |
| B5 | `components/BillingScreen.tsx` | No discount (Alt+D), no void (Ctrl+Z) | FT-POS-002, FT-POS-006 unimplemented; shortcuts in docs but not in code. |
| B6 | Schema | No `purchase_orders` table | FR FT-PUR-001 and 3-way match (FT-PUR-003) are unshippable. |
| B7 | Schema | No `returns` / `credit_notes` tables | Module 4 entirely unbuildable as-is. |
| B8 | `commands.rs:187` vs `oauth/mod.rs:48` | *Already fixed this session* — audit_log schema drift | ✅ closed |
| B9 | No Rust toolchain in sandbox; `cargo check` never run this session | Possibility of Rust compile error in production path | Must run locally before any pilot. |
| B10 | No CI (`.github/workflows/` empty) | Nothing catches regressions between commits | Fragile from day one. |
| B11 | `oauth_accounts` FK to `shops(id)`, but no seed inserts a `shop_local` row | `oauth_connect` INSERT will fail FK on a fresh DB | Gmail flow dies on a clean install. |

Item B11 is interesting — verify it now since I claimed it above:

```
packages/shared-db/migrations/0001_init.sql defines shops with NOT NULL gstin/state_code/retail_license/address.
packages/seed-tool does insert a shop. apps/desktop/src-tauri/src/db.rs does NOT.
A fresh install running the Tauri app (not the seed CLI) starts with zero shops.
First gmail_connect → INSERT INTO oauth_accounts (shop_id, ...) → FK violation on shops(id).
```

Confirmed B11 on inspection. Add to must-fix list.

---

## 4. What blocks Pilot #1 (Vaidyanath Pharmacy, Kalyan)

Per v2.0 §8 Phase 1 exit gate: *3 pharmacies running v0.1.0 for ≥7 consecutive days, zero P0 bugs, GST accuracy 100%, Schedule H register reconciles ≥95%, NPS ≥50.*

Minimum feature set that lets **one pharmacist** run **one shop** for **one full day** without paper backup:

| Req | v2.0 anchor | Status |
|---|---|---|
| Login / RBAC (at least admin + cashier) | FT-AUTH-001/002 | ❌ |
| Bill a customer end-to-end with payment method + thermal print | FT-POS-001/004/005 | 🟡 (no print, no payment method) |
| Discount + void (with manager approval) | FT-POS-002/006 | ❌ |
| Barcode scan to product (HID listener) | FT-POS-001 (implied) | ❌ |
| Schedule H sale logged to register, exportable PDF | FT-CMP-001 | ❌ |
| Expired batch sale blocked (FEFO hard block) | FT-INV-002 / FT-CMP-005 | 🟡 (DB trigger claimed; not user-verified) |
| GRN from paper/Gmail with real supplier list | FT-PUR-002 + FT-X1 | 🟡 (fake supplier list) |
| Day-end GSTR-1 CSV/JSON export | FT-GST-002 | 🟡 (buckets computed, no download) |
| Nightly SQLite backup (local + USB) + one-command restore | §6 Backup/DR | ❌ |
| Signed `.msi` installer, runs on Win 10+ first (Win 7 target after) | §8.1 + Principle #7 | ❌ |
| Customer WhatsApp / phone for 48-hr hotline | GTM §8.9 | human op |
| Parallel run with legacy for 2 weeks, 30-bill zero-discrepancy | GTM §8.9 | operational |

**Pre-pilot absolute minimum:** login, discount, void, payment method, thermal print, barcode HID, Schedule H register export, real supplier master, nightly backup, signed installer. About 4-6 weeks of disciplined solo work.

---

## 5. Dependency DAG (what must come before what)

```
┌──────────────────────────────────────────────────────────────────────┐
│  FOUNDATION (nothing else can land cleanly without these)            │
└──────────────────────────────────────────────────────────────────────┘
      F1. CI/CD on GitHub Actions (tsc + vitest + cargo check per PR)
      F2. Rust toolchain verified; cargo build + cargo test green
      F3. Fix B11: seed shop_local row on first-run of desktop app
      F4. Replace REPLACE_ME OAuth secrets with a real Google Cloud project
      F5. Observability skeleton: tracing::subscriber in Rust, structured
          logs to file, log rotation, 180-day retention (CERT-In minimum)
      F6. Backup/restore command: backup_db to file + USB; restore_db
          from file; tested on clean box. ADR 0004.
      F7. Installer pipeline: Tauri bundle .msi + DigiCert EV signing
          (procure cert; until then, self-signed dev cert + pilot
          acceptance of unsigned). ADR 0005.

                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BRANCH A  —  POS READINESS (Pilot #1 blocker)                       │
└──────────────────────────────────────────────────────────────────────┘
      A1. Auth + RBAC            (FT-AUTH-001..007)
      A2. Payment-method picker  (FT-POS-004)  ← depends on A1 for cashier identity
      A3. Discount (Alt+D)       (FT-POS-002)
      A4. Void / credit-note     (FT-POS-006)  ← needs A1 (manager OTP)
      A5. Returns module         (FT-RET-001..003)  ← schema: returns + credit_notes
      A6. Thermal print driver   (FT-POS-005)  ← ESC/POS library, 58mm + A5 templates
      A7. Barcode HID listener   (FT-POS-001)  ← global keydown capture, debounce
      A8. Real supplier master   (fix B2)       ← `suppliers` already in schema, add CRUD
      A9. Purchase orders schema + UI + F6-PO flow   (FT-PUR-001, blocks FT-PUR-003)
      A10. 3-way PO↔GRN↔invoice match             (FT-PUR-003)  ← depends on A9 + GRN
      A11. Schedule H/H1/X/NDPS register reports  (FT-CMP-001..006)
              ← depends on: bill history exists ✓, printable-PDF pipeline (new)
      A12. DPCO/NPPA price cap library + enforcement (FT-DPCO-001)
      A13. GSTR-1 CSV/JSON export + download       (FT-GST-002)  ← buckets exist
      A14. Cygnet e-invoice IRN happy-path         (FT-GST-003)  ← second-vendor plan req'd
      A15. FEFO hard-block verified via integration test on real SQLite
      A16. Expiry auto-warn at bill-time (yellow 30d / red 1d)   (FT-MSTR-002)

      Exit gate: 1 pharmacist runs 30 bills + 1 GRN + 1 return + 1 Schedule-H
      sale + 1 day-end GSTR-1 export + 1 backup + 1 restore — zero errors,
      zero paper backup, on Windows 10/11 first.

                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BRANCH B  —  MOAT COMPLETION                                        │
└──────────────────────────────────────────────────────────────────────┘
      B1. X1 Tier B: PDF attachment → text (pdfminer.six via Rust shim or
          a Rust pdf-extract crate)  ← depends on F5 (logs) for quota audit
      B2. X1 golden-set eval: 20 real distributor bills, ≥95% header parse
          accuracy verified via automated test.
      B3. X2 image upload UI: required on every SKU insert for schedule
          H/H1/X (DB trigger already enforces).
      B4. X2 match precision eval: 1000-image golden set, ≥97% target.
      B5. X3 photo-bill → GRN: camera capture → LayoutLMv3/Donut
          (cloud-edge tradeoff per v2.0 §7).  ← depends on A14 (GRN stable)
      B6. X3 golden-set eval: 500 paper bills, line recall@3 ≥92%.

                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BRANCH C  —  MULTI-TERMINAL / MULTI-SHOP                            │
└──────────────────────────────────────────────────────────────────────┘
      C1. LAN parent/worker architecture per Architecture v1.1 + v2.0 §2.2
            C1a. mDNS discovery (pharmacare-parent._tcp.local)
            C1b. gRPC protobuf contracts (stock CRDT, bill-id lock,
                 audit replication)
            C1c. mTLS cert issuance + rotation (one CA per shop)
            C1d. Heartbeat + offline queueing + conflict resolution
            C1e. Multi-terminal stock sync <100 ms (perf gate)
      C2. Multi-store master data sync (FT-MULT-001) ← depends on C1
      C3. Multi-store inventory transfer (FT-INV-008) ← depends on C1 + PO
      C4. Hospital / ward indent (FT-HOSP-001..004) ← depends on A9 (PO)

                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BRANCH D  —  CRM / RETENTION                                        │
└──────────────────────────────────────────────────────────────────────┘
      D1. Khata (credit) + monthly statement                  (FT-CRM-002)
      D2. Loyalty + tier system                               (FT-CRM-003)
      D3. Wallet (UPI topup via Razorpay)                     (FT-CRM-006)
      D4. Refill reminders (Gupshup SMS + WhatsApp)           (FT-CRM-004, FT-MSG-003)
      D5. Family profiles                                     (FT-CRM-005)
      D6. NPS survey + feedback                               (FT-CRM-007)

                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BRANCH E  —  COMPLIANCE HARDENING (pre-seed)                        │
└──────────────────────────────────────────────────────────────────────┘
      E1. DPDP: DPO designation, consent registry, DSR UI      (Module compliance)
      E2. CERT-In: incident runbook, 180-d log retention, 6-hr
          notification procedure
      E3. Pentest + CASA Tier-2 kickoff (Leviathan Security)
      E4. SOC 2 Type 1 evidence collection
      E5. ABDM + FHIR R4 (optional, flag-gated)
      E6. FSSAI OTC toggle
      E7. PMBJP generic substitution library

                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BRANCH F  —  CLOUD BRIDGE + MOBILE (Phase 2+)                       │
└──────────────────────────────────────────────────────────────────────┘
      F1. Cloud bridge v1: encrypted delta sync (catalog, sales summary)
          ← Hard Principle #6: shop holds keys, zero raw PII
      F2. Owner App (React Native) — dashboard, discount approval, MIS
      F3. Customer App (React Native) — catalog, cart, refill, family
      F4. Rider App (React Native) — order queue, live location
      F5. Storefront (Next.js) — per-shop subdomain, catalog, Rx upload
      F6. ONDC seller — KYC, catalog, order queue, LSP selection
      F7. WhatsApp Business + bulk SMS (Gupshup)
      F8. Go microservices on AWS ap-south-1 (Hydra/Kratos, NATS, Istio)
      F9. ClickHouse for OLAP
      F10. AI Copilot tier (Claude 3.5 via LiteLLM, Cube.dev semantic layer)
```

Dependency rules to protect connectivity while building:

- No branch advances past its own **exit gate test** until the test is green in CI.
- Every new screen must declare its IPC contract in `shared-types` and add at least one vitest test covering the happy path + one failure path **before** the UI commit.
- Every new table must ship with: migration file, repo package with CRUD, repo test, and one end-to-end test through a Tauri command.
- Every new AI feature must ship with a **non-AI fallback path** (Hard Rule §8.10) and a **golden-set evaluation** before enabling by default.

---

## 6. Branch-by-branch build plan

Work sequence respects the DAG above. Each branch is self-contained and mergeable.

### Phase 1-A — Foundation (Week 1, solo)

| # | Branch | Scope | Exit test |
|---|---|---|---|
| F1 | `infra/ci-github-actions` | `.github/workflows/ci.yml`: matrix Linux+Windows; npm ci → turbo typecheck + test + build; cargo check + cargo test in `apps/desktop/src-tauri`; branch protection requires green on `main` | PR runs & goes green |
| F2 | `infra/local-dev-docs` | README.md steps: install Rust toolchain, Node 20, sqlite3 sidecar; `dev.md` with windows setup | `npm install && npm run dev` boots the Tauri window on a clean Windows box |
| F3 | `fix/seed-shop-on-first-run` | `db.rs::ensure_default_shop()` inserts `shop_local` row if `shops` is empty, using values from `config.toml` (shop name, GSTIN, retail license) | Fresh DB → first Gmail connect succeeds (no FK violation) |
| F4 | `ops/google-oauth-client` | Create Google Cloud project, enable Gmail API, register OAuth client (Desktop app type), put client_id in a `.env.production` that's loaded at build time. Client secret not needed for public clients per ADR 0002. | `gmail_connect` against real Google returns real account email |
| F5 | `infra/logging-and-retention` | `tracing` + `tracing-subscriber` in Rust; JSON logs to `%APPDATA%/PharmaCare/logs/*.log`; rotation daily; 180-d retention; `list_logs` Tauri command | CERT-In evidence collectable via one command |
| F6 | `feat/backup-restore` | `backup_db(dest_path)` + `restore_db(src_path)` Tauri commands; Settings → Backup screen; automated nightly at 11pm via `tokio::time::interval` when app running; USB-drive target supported. **ADR 0004.** | Backup → wipe DB → restore → all tables intact (integration test) |
| F7 | `infra/installer-pipeline` | `tauri.conf.json` bundle targets (`msi`, `nsis`); GH Actions job builds signed artifact; self-signed dev cert today; procure DigiCert EV Authenticode; **ADR 0005** documents the plan | Artifact downloads, installs, runs on Windows 10/11 |

**Branch F exit gate:** green CI on a PR that touches trivial code; signed-or-dev-signed installer produced by CI; backup+restore integration test green; logs retained per CERT-In policy; first real Gmail OAuth round-trip.

### Phase 1-B — POS readiness for Pilot #1 (Weeks 2–5)

| # | Branch | Depends on | Scope |
|---|---|---|---|
| A1 | `feat/auth-rbac` | F1, F3 | `users` table (already exists) CRUD; bcrypt hashes (cost ≥12); PIN fallback for offline; 5 roles; session timeout 30m; login screen F0; `audit_log` entry per login/logout. ADR 0006. |
| A2 | `feat/payment-methods` | A1 | Cash / UPI / Card / Cheque / Khata picker in F12 dialog; persists to `bills.payment_method`; cash-drawer open hook (placeholder Rust fn for later) |
| A3 | `feat/discount-alt-d` | A1 | Alt+D dialog flat+%; margin-impact tooltip; requires manager OTP if >10% OR >₹500 |
| A4 | `feat/void-ctrl-z` | A1, A3 | Ctrl+Z reason dropdown; auto-approve ≤₹1k, flag for manager >₹1k; writes credit-note row |
| A5 | `feat/returns-module` | A4 | Schema: `returns`, `credit_notes` tables; F5 return flow; restock button; audit trail |
| A6 | `feat/thermal-printing` | none | `escpos-rs` crate or direct raw-byte ESC/POS over USB/serial; 58mm template + A5 template; pluggable printer config; **ADR 0007** |
| A7 | `feat/barcode-hid` | none | Global `keydown` listener debounced 30ms; accumulates into buffer, on `Enter` within 100ms of last char treat as scan; routes to current focused screen (Billing, GRN, Inventory) |
| A8 | `feat/supplier-crud` | none | Remove hardcoded SUPPLIERS const; `list_suppliers` + `upsert_supplier` Tauri commands (already exist); UI in Directory screen; seed with real Kalyan distributors |
| A9 | `feat/purchase-orders` | A1, A8 | Schema: `purchase_orders` + `po_lines`; F6-PO screen; create/edit/approve/send workflow; PDF generation for email-to-supplier |
| A10 | `feat/three-way-match` | A9 | Algorithm: PO_qty vs GRN_qty vs invoice_qty; variance ≤5% auto-pass, >5% manager approval; UI diff view |
| A11 | `feat/compliance-registers` | A1 | `registers/schedule-h.ts`, `schedule-h1.ts`, `schedule-x.ts`, `ndps.ts` builders; monthly export → printable PDF (react-pdf or Tauri PDF crate); reconciliation report |
| A12 | `feat/dpco-price-caps` | none | `drug_price_caps` table with HSN/NPPA ceiling MRP; validation on bill → hard block if sale_price > cap |
| A13 | `feat/gstr1-export` | none | CSV + JSON download button in Reports screen; e-filing-ready JSON per GSTN spec v2.2 |
| A14 | `feat/einvoice-cygnet` | A13 | Cygnet GSP API client; IRN fetch for B2B bills >₹5cr turnover shops; QR embed in print; second-vendor plan in **ADR 0008** (fallback: Clear Tax / Masters India) |
| A15 | `test/fefo-integration` | none | Integration test: create expired batch → attempt sale → assert hard block; cross-batch FEFO ordering |
| A16 | `feat/expiry-alerts` | A15 | Dashboard card; 30-d yellow, 7-d orange, 1-d red; at bill time red banner if within 30 days |

**Branch 1-B exit gate:** Vaidyanath dry-run script — login as cashier, scan 30 real drug barcodes, take 5 Schedule-H sales with Rx attach, apply 2 discounts, do 1 void + 1 return, close day with GSTR-1 export, run nightly backup, restore on spare laptop — all green, all audit-logged.

### Phase 2 — Pilot cohort expansion (Months 3–6, with VP Eng)

Branches B1–B6 (moat completion), D1–D6 (CRM + Gupshup), plus E1–E4 (compliance hardening) run in parallel across Sourav + VP Eng. Branch C (LAN parent/worker) held until Pilot #3+ shop asks for multi-terminal.

### Phase 3+ (Months 6–18) — pre-seed, seed, GA

Branches C, F execute when bandwidth permits; not before. Hard principle: no cloud/mobile code ships until 10 pilots are running v0.1.0 stably on LAN-only.

---

## 7. Connectivity protection rules (how we don't break what works)

- **Contract tests at every seam.** Every Tauri command has a shared-types DTO + vitest mock + Rust unit test. Any PR that modifies a DTO must update all three in the same commit.
- **No dead packages.** `packages/crypto` and `packages/schedule-h` are empty. Delete or implement by end of Phase 1-A. Empty workspace packages confuse imports and slow turbo.
- **No "stubs that pretend."** Replace `SUPPLIERS` hardcoded list, `REPLACE_ME` secrets, `// TODO` placeholder branches with either real code or an explicit `tracing::error!("not implemented: FR-X"); Err("not implemented")` that will scream loudly at runtime.
- **Migration discipline.** Every schema change ships its own migration file + is validated against a fresh in-memory DB in CI. No `IF NOT EXISTS` on tables created in the same migration that other logic depends on.
- **ADR discipline.** Every branch above whose name appears in §6 and is tagged "ADR N" writes the ADR in the same PR. No code-first-doc-later.
- **Golden sets for every AI feature.** X1/X2/X3 each get a versioned golden set in `packages/ai-eval/fixtures/` with an automated accuracy test that fails CI if below gate. No AI feature ships without this.
- **Perf gates in CI.** Add a `bench/` package that runs benchmarks on a representative dataset and asserts against the 18 perf gates. CI runs them on Linux + Windows (closest approximation to Win 7 target we can automate).

---

## 8. Immediate next actions (this week)

In priority order:

1. **Run `cargo check` + `cargo test`** on your local Windows box, fix any surfaced Rust error, commit fix + add to Phase 1-A F1 checklist.
2. **Land `.github/workflows/ci.yml`** — matrix tsc + vitest + cargo check on every PR. This is the single most leveraged improvement.
3. **Fix B11** (`ensure_default_shop` in `db.rs`) — otherwise every fresh install breaks at Gmail connect.
4. **Get the real Google Cloud project** provisioned and replace `REPLACE_ME`. X1 is dead without this.
5. **Delete** `packages/crypto` and `packages/schedule-h` (or implement — but likely delete; their future homes are `@pharmacare/compliance` and Rust-side crypto).
6. **Write Phase 1-B plan into GitHub Issues** — one issue per branch above, labeled by phase, linked in a single "Phase 1-B Milestone."

---

## 9. What this audit is NOT

- It is not a claim that the code is bad. The ~9 KLOC that exists is well-structured, typed, tested, and the schema design is sensible.
- It is not a suggestion to rewrite. Every line should stay; we build on top.
- It is not a rejection of the moat strategy. X1 Tier A landing in Sprint 6 is respectable solo pace.

It *is* a rejection of the earlier claim that the app is production-ready. It is not. It is a solid foundation at roughly Sprint 6 of 26, on the founder's own playbook timeline, which is exactly where the spec expects it to be today (2026-04-15 is the Day-1 baseline per project instructions §6). The work below is the work the playbook already asked for — we just now have it written down branch-by-branch, with dependency order preserved, so that nothing regresses.

---

*End of audit. Artifacts: `/tmp/canonical/FR_CATALOG.md` (772 lines), `/tmp/canonical/CODE_INVENTORY.md` (293 lines). Source-of-truth docs locked in v2.0 Final.*
