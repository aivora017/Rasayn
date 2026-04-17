# ADR 0014 — A9: Invoice Print

## Status
Proposed · 2026-04-17 · Serial off A7 (c3c41f2) · Parallel-safe w.r.t. A10/A11

## Context
Hard Rule 5 of the Playbook: "compliance automatic, never manual." Every retail bill must print with shop retail license no., GSTIN, HSN-wise tax summary, Rx doctor details on Schedule H/H1/X (D&C Rules 1945 r.65), and retain a print audit trail for inspector visits. Pilot pharmacies (Vaidyanath etc.) use thermal 80mm roll printers for counter bills; walk-in B2B (clinic, dispensary) needs A5 GST-format on plain paper. Both must share the same bill record — layout is a print-time concern, not a data-model concern. A6 (bill-core), A7 (rx-capture), A8 (payment tenders) landed the data. A9 is the render + audit + reprint layer.

## Decision
- **New package `packages/invoice-print`** — pure TS template engine. Exports `renderInvoiceHtml(bundle: InvoiceBundle, layout: "thermal_80mm" | "a5_gst"): string`. Zero DOM deps; returns a self-contained `<html>` string with inline CSS. No PDF lib; browser `window.print()` hits the system's "Save as PDF" / physical printer.
- **New Rust command `get_bill_full(bill_id)`** → `BillFullDTO { shop, bill, customer?, prescription?, lines[], payments[], hsnTaxSummary[] }`. Single round-trip for print; joins across `bills`, `bill_lines`, `payments`, `prescriptions` (via `bills.rx_id`), `doctors`, `customers`, `shops`, `products` (for HSN). HSN summary computed at read time (grouped by `bill_lines.hsn` with CGST/SGST/IGST subtotals).
- **Migration `0013_print_audit.sql`** — `print_audit(id, bill_id, layout, printed_at, actor_user_id, is_duplicate)` + index on `bill_id`. First row per bill = `is_duplicate=0` ("ORIGINAL"); subsequent = `is_duplicate=1` ("DUPLICATE — REPRINT"). Stamp is watermarked in the rendered HTML.
- **New Rust command `record_print(bill_id, layout, actor_user_id) -> PrintReceiptDTO`** — inserts `print_audit` row and returns `{ printCount, isDuplicate, stampedAt }`. Atomic: first call → `is_duplicate=0`; subsequent → `is_duplicate=1`.
- **B2B vs B2C auto-selection.** `customer.gstin` non-null → B2B header block (customer GSTIN + legal name + address). Else B2C. Layout choice (thermal vs a5) is orthogonal; default from `settings.default_invoice_layout` (thermal for pilot).
- **BillingScreen F9 = print** (keyboard contract). After F10=save succeeds, F9 fires `record_print` + opens child window with `renderInvoiceHtml(bundle, layout)` + auto-triggers `window.print()`. F9 before save = toast "Save first (F10)".
- **Compliance footer (every layout).** Shop retail license, GSTIN, FSSAI (if set), pharmacist name + reg_no (from `shops.pharmacist_*` — ADD COLUMN in 0013), cashier name (lookup via `actor_user_id`), "PharmaCare Pro v{pkg.version}".
- **Rx block** — when `bill.rx_id != null`, print doctor name + reg_no + issue date. Schedule H lines list prescription ID in the line-item row.
- **Round-off + tender breakdown** — round-off line printed separately. Tender lines: each `payments` row printed as "Cash ₹X · UPI ₹Y · Change ₹Z".
- **Perf gate.** `get_bill_full` + `renderInvoiceHtml` round-trip `<300 ms` p95 on 30-line bill (Windows 7 / HDD / 4GB target). Measured by `perf.test.ts` in `packages/invoice-print`.

## Consequences
- Unblocks pilot go-live (printable GST-compliant bill is table stakes).
- `print_audit` gives inspector a queryable trail of every duplicate printed — pre-empts "reprint fraud" accusation.
- HTML-only render avoids native PDF libs — zero binary size cost, zero font-licensing risk. Print-to-PDF via OS.
- `get_bill_full` becomes the read surface for A10 GSTR-1 export line detail and A11 stock-reconcile bill reconciliation; not A9-specific cost.
- Layout CSS lives in `invoice-print` package (not desktop app) so the TS testbed can snapshot-test HTML output without spinning up Tauri.

## Alternatives considered
1. **Server-side PDF render (headless chrome, puppeteer)** — rejected: violates Hard Rule 1 (LAN-first, cloud-optional) and Hard Rule 7 (hardware floor; puppeteer needs Chrome binary, breaks 2GB RAM target).
2. **Native PDF lib (`printpdf`, `genpdf` Rust crates)** — rejected: 3–5 MB binary cost; font embedding licensing unclear for Devanagari (Hindi/Marathi pharmacy names).
3. **Print directly from Tauri `window.print()` without child window** — rejected: pollutes the billing-screen DOM; browser zoom / print CSS collides with the live UI.
4. **Separate `thermal_80mm` vs `a5_gst` render functions** — rejected: 90% of the template is shared (header, Rx, lines, tax, footer); CSS media queries + a layout flag keep it one function.
5. **Skip `print_audit`, rely on reprint button state** — rejected: no evidence trail for inspector; D&C inspector routinely asks "show me all duplicates printed this month."

## Scope boundaries (not in this ADR — separate tracks)
- **A9b · Schedule H/H1/X daily register CSV export** — separate ADR addendum. Uses `prescriptions` + `bill_lines` join; independent of print pipeline.
- **A9c · Reprint lookup screen** (search by bill_no or customer_phone → list → F9 reprint) — separate ADR. Depends on A9 print pipeline.
- **Pharmacist signature image embed** — deferred to A9 addendum after pilot feedback. Schema is forward-compatible (shop pharmacist_signature_path can be added in 0014).

## Supersedes
None.
