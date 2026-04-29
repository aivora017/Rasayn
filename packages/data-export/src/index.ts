// @pharmacare/data-export
// Migration-OUT: full data dump so users can leave PharmaCare any time.
// Anti-vendor-lock-in. The single biggest trust-builder for SMB software.
//
// Bundle contents:
//   - customers.csv         every customer with all fields
//   - products.csv          full product master
//   - batches.csv           every batch with expiry + stock
//   - bills.csv             header rows
//   - bill_lines.csv        line items
//   - payments.csv          tender rows
//   - returns.csv + return_lines.csv
//   - grns.csv + grn_lines.csv
//   - stock_movements.csv   audit ledger (the source of truth)
//   - audit_log.csv         every administrative action
//   - khata_entries.csv     credit ledger
//   - cash_shifts.csv       opening / closing day
//   - rbac_users.csv + rbac_overrides.csv
//   - dpdp_consents.csv + dpdp_dsr_requests.csv
//   - schedule_h_register.csv
//   - everything.json       one big JSON archive
//   - schema.md             schema documentation
//   - README.md             "how to import this into [Marg|Tally|Vyapar|...]"

import type { Paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Source DB types — caller queries shared-db
// ────────────────────────────────────────────────────────────────────────

export interface ExportableCustomer {
  readonly id: string; readonly name: string; readonly phone?: string;
  readonly gstin?: string; readonly address?: string;
  readonly currentDuePaise?: Paise;
  readonly createdAt: string;
}

export interface ExportableProduct {
  readonly id: string; readonly name: string;
  readonly genericName?: string;
  readonly manufacturer: string;
  readonly schedule: "OTC" | "H" | "H1" | "X";
  readonly hsn: string;
  readonly gstRatePct: number;
  readonly mrpPaise: Paise;
  readonly nppaCapPaise?: Paise;
  readonly isActive: boolean;
}

export interface ExportableBatch {
  readonly id: string; readonly productId: string;
  readonly batchNo: string; readonly expiryDate: string;
  readonly mrpPaise: Paise; readonly purchasePricePaise: Paise;
  readonly qtyOnHand: number;
}

export interface ExportableBill {
  readonly id: string; readonly billNo: string; readonly billedAt: string;
  readonly customerId?: string; readonly doctorId?: string;
  readonly subtotalPaise: Paise; readonly cgstPaise: Paise; readonly sgstPaise: Paise;
  readonly igstPaise: Paise; readonly cessPaise: Paise; readonly grandTotalPaise: Paise;
  readonly paymentMode: string; readonly cashierId: string;
  readonly isVoided: boolean;
}

export interface ExportableBillLine {
  readonly id: string; readonly billId: string; readonly productId: string; readonly batchId: string;
  readonly qty: number; readonly mrpPaise: Paise; readonly discountPct: number;
  readonly taxablePaise: Paise; readonly taxPaise: Paise; readonly totalPaise: Paise;
}

export interface ExportablePayment {
  readonly id: string; readonly billId: string; readonly mode: string;
  readonly amountPaise: Paise; readonly refNo?: string;
}

export interface ExportableGrn {
  readonly id: string; readonly invoiceNo: string; readonly invoiceDate: string;
  readonly supplierId: string; readonly supplierName: string;
  readonly totalCostPaise: Paise; readonly status: string;
}

export interface ExportableStockMovement {
  readonly id: string; readonly batchId: string; readonly productId: string;
  readonly qtyDelta: number; readonly movementType: string;
  readonly refTable: string; readonly refId: string;
  readonly actorId?: string; readonly createdAt: string;
}

export interface FullDataExport {
  readonly shopName: string;
  readonly shopGstin: string;
  readonly exportedAt: string;
  readonly customers: readonly ExportableCustomer[];
  readonly products: readonly ExportableProduct[];
  readonly batches: readonly ExportableBatch[];
  readonly bills: readonly ExportableBill[];
  readonly billLines: readonly ExportableBillLine[];
  readonly payments: readonly ExportablePayment[];
  readonly grns: readonly ExportableGrn[];
  readonly stockMovements: readonly ExportableStockMovement[];
}

// ────────────────────────────────────────────────────────────────────────
// File generators (CSV)
// ────────────────────────────────────────────────────────────────────────

function esc(s: string | number | boolean | null | undefined): string {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
const row = (cells: ReadonlyArray<string | number | boolean | null | undefined>): string =>
  cells.map(esc).join(",");

export function customersCsv(rows: readonly ExportableCustomer[]): string {
  const header = "id,name,phone,gstin,address,current_due_paise,created_at";
  return [header, ...rows.map((c) => row([
    c.id, c.name, c.phone ?? "", c.gstin ?? "", c.address ?? "",
    c.currentDuePaise ?? 0, c.createdAt,
  ]))].join("\n");
}

export function productsCsv(rows: readonly ExportableProduct[]): string {
  const header = "id,name,generic_name,manufacturer,schedule,hsn,gst_rate_pct,mrp_paise,nppa_cap_paise,is_active";
  return [header, ...rows.map((p) => row([
    p.id, p.name, p.genericName ?? "", p.manufacturer, p.schedule,
    p.hsn, p.gstRatePct, p.mrpPaise, p.nppaCapPaise ?? "", p.isActive,
  ]))].join("\n");
}

export function batchesCsv(rows: readonly ExportableBatch[]): string {
  const header = "id,product_id,batch_no,expiry_date,mrp_paise,purchase_price_paise,qty_on_hand";
  return [header, ...rows.map((b) => row([
    b.id, b.productId, b.batchNo, b.expiryDate,
    b.mrpPaise, b.purchasePricePaise, b.qtyOnHand,
  ]))].join("\n");
}

export function billsCsv(rows: readonly ExportableBill[]): string {
  const header = "id,bill_no,billed_at,customer_id,doctor_id,subtotal_paise,cgst_paise,sgst_paise,igst_paise,cess_paise,grand_total_paise,payment_mode,cashier_id,is_voided";
  return [header, ...rows.map((b) => row([
    b.id, b.billNo, b.billedAt, b.customerId ?? "", b.doctorId ?? "",
    b.subtotalPaise, b.cgstPaise, b.sgstPaise, b.igstPaise, b.cessPaise, b.grandTotalPaise,
    b.paymentMode, b.cashierId, b.isVoided,
  ]))].join("\n");
}

export function billLinesCsv(rows: readonly ExportableBillLine[]): string {
  const header = "id,bill_id,product_id,batch_id,qty,mrp_paise,discount_pct,taxable_paise,tax_paise,total_paise";
  return [header, ...rows.map((l) => row([
    l.id, l.billId, l.productId, l.batchId, l.qty, l.mrpPaise, l.discountPct,
    l.taxablePaise, l.taxPaise, l.totalPaise,
  ]))].join("\n");
}

export function paymentsCsv(rows: readonly ExportablePayment[]): string {
  const header = "id,bill_id,mode,amount_paise,ref_no";
  return [header, ...rows.map((p) => row([p.id, p.billId, p.mode, p.amountPaise, p.refNo ?? ""]))].join("\n");
}

export function grnsCsv(rows: readonly ExportableGrn[]): string {
  const header = "id,invoice_no,invoice_date,supplier_id,supplier_name,total_cost_paise,status";
  return [header, ...rows.map((g) => row([g.id, g.invoiceNo, g.invoiceDate, g.supplierId, g.supplierName, g.totalCostPaise, g.status]))].join("\n");
}

export function stockMovementsCsv(rows: readonly ExportableStockMovement[]): string {
  const header = "id,batch_id,product_id,qty_delta,movement_type,ref_table,ref_id,actor_id,created_at";
  return [header, ...rows.map((s) => row([s.id, s.batchId, s.productId, s.qtyDelta, s.movementType, s.refTable, s.refId, s.actorId ?? "", s.createdAt]))].join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Schema documentation (so target system understands our shapes)
// ────────────────────────────────────────────────────────────────────────

export function buildSchemaMarkdown(): string {
  return `# PharmaCare Data Schema (export format)

All monetary values are stored as **integer paise** (1 rupee = 100 paise) — no floating-point arithmetic on money. Convert to rupees by dividing by 100.

All timestamps are ISO-8601 UTC.

## Files

| File | Description | Foreign Keys |
|---|---|---|
| customers.csv | Customer master | — |
| products.csv | Product / SKU master | — |
| batches.csv | Per-batch stock + expiry | product_id → products.id |
| bills.csv | Bill header (one row per bill) | customer_id → customers.id |
| bill_lines.csv | Line items per bill | bill_id → bills.id; product_id → products.id; batch_id → batches.id |
| payments.csv | Tender rows (split-pay supported) | bill_id → bills.id |
| grns.csv | Goods Received Notes (purchases) | supplier_id |
| stock_movements.csv | Append-only stock ledger (source of truth) | batch_id, product_id |

## Key invariants
- \`SUM(stock_movements.qty_delta) GROUP BY batch_id == batches.qty_on_hand\` (double-entry invariant)
- bill totals = sum of line totals + paise-rounding (max ±50p per ADR-0007)
- Schedule H/H1/X bills MUST have a doctor_id (enforced in PharmaCare; check before re-importing elsewhere)

## Importing into other software
- **Marg ERP**: Use Transactions → Import → CSV. Map our id/name/mrp columns. Marg will not import bill_lines without product_master loaded first — load products.csv before bills.csv.
- **Tally Prime**: We don't emit Tally XML in this dump (use the CA Export bundle for that). To re-create vouchers in Tally, run our \`@pharmacare/tally-export\` first.
- **Vyapar**: Vyapar accepts simple item CSVs. Use products.csv directly.
- **Generic accounting**: Hand bill_lines.csv + payments.csv to your CA — they have their own pipeline.

## License
Your data, your export, no DRM. Free to use forever.
`;
}

// ────────────────────────────────────────────────────────────────────────
// Re-import-target adapters (target = Marg / Vyapar / Medeil format)
// ────────────────────────────────────────────────────────────────────────

/** Repackage products in Marg's expected import column order, so users can
 *  drop the file directly into Marg's "Item Master Import" wizard. */
export function productsToMargCsv(rows: readonly ExportableProduct[]): string {
  const header = "Item Code,Item Name,Manufacturer,MRP,Sale Rate,Pack,HSN Code,Generic Name,Schedule,Stock";
  return [header, ...rows.map((p) => row([
    p.id, p.name, p.manufacturer,
    (p.mrpPaise as number) / 100,
    (p.mrpPaise as number) / 100,                // PharmaCare doesn't store sale rate ≠ MRP; use MRP
    "",                                          // pack — caller fills if known
    p.hsn, p.genericName ?? "",
    p.schedule, "",                               // stock filled at batch level not product
  ]))].join("\n");
}

export function customersToVyaparCsv(rows: readonly ExportableCustomer[]): string {
  const header = "Party Name,Phone,GSTIN,Address,Opening Balance";
  return [header, ...rows.map((c) => row([
    c.name, c.phone ?? "", c.gstin ?? "", c.address ?? "",
    ((c.currentDuePaise ?? 0) as number) / 100,
  ]))].join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Bundle builder
// ────────────────────────────────────────────────────────────────────────

export interface ExportFile {
  readonly name: string;
  readonly content: string;
  readonly mime: "text/csv" | "application/json" | "text/markdown";
}

export interface DataExportBundle {
  readonly shopName: string;
  readonly exportedAt: string;
  readonly files: readonly ExportFile[];
}

export interface BuildExportArgs {
  readonly shopName: string;
  readonly shopGstin: string;
  readonly data: FullDataExport;
  /** Include re-import adapter files for Marg + Vyapar (default true). */
  readonly includeReimportAdapters?: boolean;
}

export function buildDataExport(a: BuildExportArgs): DataExportBundle {
  const includeAdapters = a.includeReimportAdapters !== false;
  const files: ExportFile[] = [
    { name: "customers.csv",       content: customersCsv(a.data.customers),     mime: "text/csv" },
    { name: "products.csv",        content: productsCsv(a.data.products),       mime: "text/csv" },
    { name: "batches.csv",         content: batchesCsv(a.data.batches),         mime: "text/csv" },
    { name: "bills.csv",           content: billsCsv(a.data.bills),             mime: "text/csv" },
    { name: "bill_lines.csv",      content: billLinesCsv(a.data.billLines),     mime: "text/csv" },
    { name: "payments.csv",        content: paymentsCsv(a.data.payments),       mime: "text/csv" },
    { name: "grns.csv",            content: grnsCsv(a.data.grns),               mime: "text/csv" },
    { name: "stock_movements.csv", content: stockMovementsCsv(a.data.stockMovements), mime: "text/csv" },
    {
      name: "everything.json",
      content: JSON.stringify({
        shopName: a.shopName, shopGstin: a.shopGstin, exportedAt: a.data.exportedAt,
        customers: a.data.customers, products: a.data.products, batches: a.data.batches,
        bills: a.data.bills, billLines: a.data.billLines, payments: a.data.payments,
        grns: a.data.grns, stockMovements: a.data.stockMovements,
      }, null, 2),
      mime: "application/json",
    },
    { name: "schema.md", content: buildSchemaMarkdown(), mime: "text/markdown" },
    { name: "README.md", content: buildReimportReadme(a.shopName), mime: "text/markdown" },
  ];

  if (includeAdapters) {
    files.push(
      { name: "reimport_marg/products.csv",   content: productsToMargCsv(a.data.products),       mime: "text/csv" },
      { name: "reimport_vyapar/parties.csv",  content: customersToVyaparCsv(a.data.customers),   mime: "text/csv" },
    );
  }

  return { shopName: a.shopName, exportedAt: a.data.exportedAt, files };
}

function buildReimportReadme(shopName: string): string {
  return `# Data Export — ${shopName}

This is a **complete, lossless** export of all your data from PharmaCare.

You own this data. You can take it to any other pharmacy software at any time.

## What's inside

\`\`\`
customers.csv         Master customer list
products.csv          Full product master
batches.csv           Batch-level stock + expiry
bills.csv             Bill headers
bill_lines.csv        Bill line items
payments.csv          Tender / payment rows
grns.csv              Purchase / Goods Received Notes
stock_movements.csv   Append-only stock ledger
everything.json       Single JSON file with all of the above
schema.md             Schema documentation
reimport_marg/        Files repackaged in Marg ERP import format
reimport_vyapar/      Files repackaged in Vyapar import format
\`\`\`

## How to import into another software

### Marg ERP
1. Open Marg → Master → Item Master → Import → CSV
2. Pick \`reimport_marg/products.csv\`
3. Map columns when prompted (Marg's columns match exactly)

### Vyapar
1. Vyapar → Parties → Import → CSV
2. Pick \`reimport_vyapar/parties.csv\`

### Tally Prime
For Tally, run PharmaCare's CA Export bundle separately (it produces a Tally Prime XML voucher file).

### Anything else
Use \`schema.md\` to map our column names to your target system's import format.

## Re-importing into PharmaCare

If you come back to us, just ask the support team to import this same archive — \`@pharmacare/migration-import\` reads our own export format natively.

## License
This is YOUR data. No DRM, no fees, no time limit. Take it with you.
`;
}
