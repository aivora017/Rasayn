# PharmaCare — Updated Requirements (Sellable Software, v3)

Last updated 2026-04-28 after pivot from "Jagannath-only" → "personal use today, sellable later."

## Three usage phases

| Phase | Who | Scope |
|---|---|---|
| **Phase A — Now (you)** | Sourav at Jagannath Pharmacy LLP | Standalone install. Zero recurring deps. |
| **Phase B — Closed beta (Q3 2026)** | 5–10 friendly pharmacies (referrals) | Free / discounted. Same standalone install. Migration tools front-and-centre. |
| **Phase C — Sellable (Q4 2026+)** | Public sale | Adds licence-key system, code signing, support tooling. |

## What you need RIGHT NOW (Phase A) — total: ₹0

| Item | Status | Source |
|---|---|---|
| Tauri 2.10.3 / React 19.2 / TS / Tailwind 4 | open-source | already in package.json |
| SQLite + WAL + FTS5 | open-source | ships with Tauri |
| Hardware: barcode printer · inkjet · tester PC · monitor · barcode scanner | ✓ you own | already procured |
| Cloudflare account (DNS, R2 backup if used) | free tier | cloudflare.com |
| AWS account (S3 backup, free 12mo) | free tier | aws.amazon.com |
| Domain | ✓ you own | already paid |

**Cash spend to start using PharmaCare at Jagannath = ₹0.**

## What you'll want for Phase B (closed beta, ~₹5,000 one-time)

| Item | Cost | Why | When |
|---|---|---|---|
| **Test machines for friend pharmacies** | ₹0 (they have their own PCs) | They install on their existing setup | beta starts |
| **Cloudflare R2 storage** | Free 10GB tier suffices for 10 shops | Off-site encrypted backup of each shop's SQLite | beta starts |
| **MSME Udyam registration** | Free | Government recognition; useful for B2B credibility | before first paid customer |
| **Trademark "Rasayn" / "PharmaCare Pro"** | ₹4,500 in Class 9 (software) | Protects brand before public launch | before public launch |

## What you'll need for Phase C (selling publicly) — graduated spend

### Tier 1: launch essentials (~₹50,000 first year)

| Item | Cost | Why |
|---|---|---|
| **DigiCert EV Authenticode code-signing certificate** | ₹35,000–55,000/yr | Buyers' Windows shows SmartScreen warnings on unsigned MSI = no sales. Mandatory once selling. |
| **Razorpay payment gateway for software sales** | Free signup · 2% MDR | Accept card/UPI payments for software licences |
| **Trademark Class 42 (SaaS services)** | ₹4,500 | Adds service-mark protection beyond Class 9 |
| **Privacy Policy + Terms of Service review** | ₹15,000 (one-time) | Legal cover for selling software, DPDP Act 2023 compliance |

### Tier 2: when you cross 50 paying customers (~₹2L/yr)

| Item | Cost | Why |
|---|---|---|
| **Issue tracker (Linear / GitHub Issues Pro)** | $8/mo or free | Track customer-reported bugs |
| **Help desk (Zoho Desk / Crisp)** | ₹0–2,000/mo | Customer support inbox |
| **Analytics opt-in (Plausible / self-hosted Umami)** | Free or ₹500/mo | Privacy-friendly anonymous usage stats |
| **Auto-update server (self-hosted on Cloudflare Workers)** | Free tier | Push updates to customers' MSI installs |
| **CASA Tier-2 audit (Leviathan)** | ~₹10L (one-time, then refresh every 2y) | Required if you offer Gmail OAuth distributor inbox at scale |

### Tier 3: enterprise / chain customers (negotiated)

Cygnet/ClearTax GSP, SOC 2 Type 1, external pentest, cyber liability insurance — all customer-driven. You add when a customer's procurement asks for it.

## What we DELIBERATELY DON'T DEPEND ON

These were on the original list but are now replaced or dropped:

| Dependency | Why dropped | Replaced by |
|---|---|---|
| Cygnet GSP / ClearTax GSP | Most customers <₹5cr B2B → don't need IRN | `@pharmacare/ca-export-bundle` — CA uploads JSON manually |
| Anthropic API / Gemini Vision / Sarvam | Cost + lock-in. Most customers don't need them. | Mock LLM gateway today; **bring-your-own-key**: customer can plug in Ollama (free local) or any OpenAI-compatible endpoint. |
| Hugging Face | Model downloads create deps | Bundled curated DDI seed (free) |
| Gupshup BSP / MSG91 SMS | Per-message cost | `@pharmacare/share-utils` — `wa.me` deep links, free |
| CIMS-India formulary | ₹50–100k/yr | Curated 42-ingredient + 25-pair seed, bundled |
| DigiCert EV (for Phase A) | Phase A is personal | Buy when Phase C starts |
| SOC 2 / CASA | Phase C only when enterprise customers ask | Defer |

## Migration-in / Migration-out (THE KILLER DIFFERENTIATOR)

Most pharmacy software hostages your data. We don't.

### Migration-IN (we just built this)

| Source | Adapter | File format | Status |
|---|---|---|---|
| Marg ERP — Items | `adaptMargItemMasterCsv` | CSV | ✓ shipped |
| Marg ERP — Customers | `adaptMargCustomerCsv` | CSV | ✓ shipped |
| Tally Prime | `adaptTallyXml` | XML voucher dump | ✓ shipped |
| Vyapar | `adaptVyaparItemCsv` | CSV | ✓ shipped |
| Medeil | `adaptMedeilDrugCsv` | CSV | ✓ shipped |
| Generic CSV (any source) | `adaptGenericCsv` | CSV with field-map | ✓ shipped |
| **Coming next** | GoFrugal · eVitalRx · BharatERP | CSV/JSON | scaffolds ready |

### Migration-OUT (we just built this)

Single button "Export everything" → ZIP with:
- 8 CSV files (customers, products, batches, bills, bill-lines, payments, GRNs, stock-movements)
- `everything.json` archive
- `schema.md` documentation
- `reimport_marg/` directory (Marg-format)
- `reimport_vyapar/` directory (Vyapar-format)
- `README.md` with step-by-step "import this into [vendor]" instructions

## Sellable-software requirements you should own (deep research)

### Required compliance for selling software in India
- **GST registration on selling entity** — already done (Jagannath LLP)
- **HSN code 998314** — software licensing services, 18% GST
- **Income Tax Act §44ADA** — presumptive taxation for software professionals (eligible if turnover < ₹75L)
- **DPDP Act 2023** — Privacy Policy + consent registry (we built `@pharmacare/dpdp`)
- **Software Export from India (STPI)** — only if exporting; ignore for India sales

### Optional but strong for sellability
- **MSME Udyam** (free) — government tenders + 45-day payment law applies
- **ISO 9001** (~₹50k for first cert) — quality badge for institutional buyers
- **Trademark** (Class 9 + 42 = ₹9,000) — defensive

### Pricing model the research supports
- **Perpetual licence ₹14,999 + AMC ₹4,999/yr** (Marg/LOGIC pattern) — works for cost-sensitive single-shops
- **SaaS subscription ₹999/mo** (eVitalRx pattern) — works for chains
- **Free tier 1 user / 100 bills/mo** — top-of-funnel acquisition
- We can offer all 3 — same MSI, different licence keys

## Phase A → Phase C transition checklist

When you're ready to sell:

1. ✓ Migration-in / out shipped (done)
2. ✓ Multi-entity-type registration (done)
3. ☐ Buy DigiCert EV cert (₹35-55k)
4. ☐ Build licence-key system (~3 days work — `@pharmacare/license` package)
5. ☐ Build update server (1 day — Cloudflare Workers)
6. ☐ Privacy Policy + Terms drafted by lawyer (₹15k)
7. ☐ Trademark filed (₹9k)
8. ☐ Build pricing page on Next.js storefront (already scaffolded as `apps/web/storefront`)
9. ☐ Razorpay payment gateway integrated for licence purchase

Total: **~₹70,000 one-time + ₹8,000/yr** to be public-sellable.

## Net-net for you today

**Spend ₹0 right now. Use the software at Jagannath. Build customer feedback. When you have 5 friendly pharmacies asking for it, spend ₹70k once and start selling.**
