// @pharmacare/ca-export-bundle
// Single-button "Export for CA" — produces every file an Indian CA needs to
// file monthly GST returns + annual LLP Form 8 / Form 11 / ITR-5 for Jagannath.
//
// Why this exists: Cygnet/ClearTax GSP creates a paid SaaS dependency we don't
// want. CA-friendly file bundle is the standalone alternative — CA imports
// our JSON/CSV into their own tools (Tally, ClearTax CA portal, etc.) and
// files from there. Zero PharmaCare cloud touchpoints.
//
// Bundle contents (each can be opted in/out):
//
//   GST monthly:
//     - gstr1_{period}.json         GSTN-spec JSON for direct portal upload
//     - gstr3b_{period}.json        Summary
//     - gstr2b_recon_{period}.csv   Reconciliation against portal data
//     - sales_register_{period}.csv Indexed by bill: HSN, GST split, customer GSTIN
//     - purchase_register_{period}.csv Same shape for GRNs
//     - hsn_summary_{period}.csv    HSN-wise aggregate
//
//   LLP annual (FY April → March):
//     - trial_balance_FY{yyyy}.csv  Per-account opening + debit + credit + closing
//     - profit_loss_FY{yyyy}.csv    Revenue, COGS, expenses, net profit
//     - balance_sheet_FY{yyyy}.csv  Assets, liabilities, partners' capital
//     - llp_form8_inputs_FY{yyyy}.json  Solvency + financial summary for Form 8
//     - cash_book_{period}.csv
//     - day_book_{period}.csv
//
//   Tally / accounting partners:
//     - tally_prime_{period}.xml    Voucher import for Tally
//     - zoho_books_{period}.csv     Zoho import shape
//     - quickbooks_{period}.iif     QB import shape
//
//   Cover page:
//     - README.md                   What's in the bundle, how the CA uses each file

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";
import { buildGstr3b, reconcile2b, type BillRow as Gstr3bBillRow, type PurchaseRow as Gstr3bPurchaseRow, type Gstr2bPortalRow } from "@pharmacare/gst-extras";
import { buildTallyXml, billToSalesVoucher, buildZohoBooksCsv, buildQuickBooksIIF, type TallyVoucher } from "@pharmacare/tally-export";
import { complianceGroupsFor, ENTITY_TYPES, type EntityType, type ComplianceFileGroup } from "@pharmacare/entity-types";

// ────────────────────────────────────────────────────────────────────────
// Source row types (caller queries from shared-db)
// ────────────────────────────────────────────────────────────────────────

export interface BillRow {
  readonly billId: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly customerName: string;
  readonly customerGstin?: string;
  readonly customerStateCode: string;
  readonly subtotalPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly totalPaise: Paise;
  readonly isRefund: boolean;
  readonly hsnLines: ReadonlyArray<{ hsn: string; taxableValuePaise: Paise; gstRate: number }>;
}

export interface PurchaseRow {
  readonly grnId: string;
  readonly invoiceNo: string;
  readonly invoiceDate: string;
  readonly supplierName: string;
  readonly supplierGstin: string;
  readonly subtotalPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly totalPaise: Paise;
  readonly itcEligible: boolean;
}

export interface CashRow {
  readonly date: string;
  readonly description: string;
  readonly cashInPaise: Paise;
  readonly cashOutPaise: Paise;
  readonly mode: "cash" | "upi" | "card" | "cheque" | "credit";
  readonly ref: string;
}

export interface ExpenseRow {
  readonly date: string;
  readonly account: string;       // "Rent", "Salaries", "Electricity", "Stationery", etc.
  readonly amountPaise: Paise;
  readonly hasGstInput: boolean;
  readonly gstInputPaise?: Paise;
  readonly note?: string;
}

export interface PartnerInfo {
  readonly designatedPartnerId: string;
  readonly name: string;
  readonly contributionPaise: Paise;
}

// ────────────────────────────────────────────────────────────────────────
// Bundle envelope
// ────────────────────────────────────────────────────────────────────────

export interface BundleFile {
  readonly name: string;
  readonly content: string;
  readonly mime: "text/csv" | "application/json" | "application/xml" | "text/markdown" | "text/plain";
  readonly purpose: string;
  readonly forForm: "GSTR-1" | "GSTR-3B" | "GSTR-2B" | "LLP Form 8" | "LLP Form 11" | "ITR-5" | "Tally Import" | "Zoho Import" | "QuickBooks Import" | "Pharmacy Records";
}

export interface CABundle {
  readonly shopName: string;
  readonly shopGstin: string;
  readonly llpRegNo?: string;
  readonly period: string;        // "2026-04" or "FY2025-26"
  readonly periodStart: string;   // ISO
  readonly periodEnd: string;
  readonly generatedAt: string;
  readonly files: readonly BundleFile[];
}

// ────────────────────────────────────────────────────────────────────────
// CSV escaping
// ────────────────────────────────────────────────────────────────────────

export function escapeCsv(s: string | number | boolean | null | undefined): string {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function csvRow(cells: ReadonlyArray<string | number | boolean | null | undefined>): string {
  return cells.map(escapeCsv).join(",");
}

// ────────────────────────────────────────────────────────────────────────
// Sales register
// ────────────────────────────────────────────────────────────────────────

export function buildSalesRegisterCsv(bills: readonly BillRow[]): string {
  const header = ["Bill No","Date","Customer","Customer GSTIN","State Code","Subtotal","CGST","SGST","IGST","CESS","Total","Is Refund"];
  const rows = bills.map((b) => csvRow([
    b.billNo, b.billedAt, b.customerName, b.customerGstin ?? "", b.customerStateCode,
    (b.subtotalPaise as number) / 100,
    (b.cgstPaise as number) / 100,
    (b.sgstPaise as number) / 100,
    (b.igstPaise as number) / 100,
    (b.cessPaise as number) / 100,
    (b.totalPaise as number) / 100,
    b.isRefund ? "Y" : "N",
  ]));
  return [header.join(","), ...rows].join("\n");
}

export function buildPurchaseRegisterCsv(purchases: readonly PurchaseRow[]): string {
  const header = ["Invoice No","Date","Supplier","Supplier GSTIN","Subtotal","CGST","SGST","IGST","CESS","Total","ITC Eligible"];
  const rows = purchases.map((p) => csvRow([
    p.invoiceNo, p.invoiceDate, p.supplierName, p.supplierGstin,
    (p.subtotalPaise as number) / 100,
    (p.cgstPaise as number) / 100,
    (p.sgstPaise as number) / 100,
    (p.igstPaise as number) / 100,
    (p.cessPaise as number) / 100,
    (p.totalPaise as number) / 100,
    p.itcEligible ? "Y" : "N",
  ]));
  return [header.join(","), ...rows].join("\n");
}

// HSN summary
export function buildHsnSummaryCsv(bills: readonly BillRow[]): string {
  const map = new Map<string, { gstRate: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; lineCount: number }>();
  for (const b of bills) {
    if (b.isRefund) continue;
    for (const line of b.hsnLines) {
      const existing = map.get(line.hsn) ?? { gstRate: line.gstRate, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, lineCount: 0 };
      existing.taxablePaise += line.taxableValuePaise as number;
      // Pro-rate header GST against this line's share of bill subtotal
      const billSub = b.subtotalPaise as number || 1;
      const share = (line.taxableValuePaise as number) / billSub;
      existing.cgstPaise += Math.round((b.cgstPaise as number) * share);
      existing.sgstPaise += Math.round((b.sgstPaise as number) * share);
      existing.igstPaise += Math.round((b.igstPaise as number) * share);
      existing.lineCount += 1;
      map.set(line.hsn, existing);
    }
  }
  const header = ["HSN","GST Rate %","Lines","Taxable Value","CGST","SGST","IGST","Total Tax"];
  const rows = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hsn, agg]) => csvRow([
    hsn, agg.gstRate, agg.lineCount,
    agg.taxablePaise / 100, agg.cgstPaise / 100, agg.sgstPaise / 100, agg.igstPaise / 100,
    (agg.cgstPaise + agg.sgstPaise + agg.igstPaise) / 100,
  ]));
  return [header.join(","), ...rows].join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Cash book + day book
// ────────────────────────────────────────────────────────────────────────

export function buildCashBookCsv(rows: readonly CashRow[]): string {
  const header = ["Date","Description","Mode","Cash In","Cash Out","Running Balance","Ref"];
  let bal = 0;
  const out = rows.map((r) => {
    bal += (r.cashInPaise as number) - (r.cashOutPaise as number);
    return csvRow([
      r.date, r.description, r.mode,
      (r.cashInPaise as number) / 100,
      (r.cashOutPaise as number) / 100,
      bal / 100,
      r.ref,
    ]);
  });
  return [header.join(","), ...out].join("\n");
}

export function buildDayBookCsv(bills: readonly BillRow[], purchases: readonly PurchaseRow[]): string {
  const header = ["Date","Type","Ref","Party","Subtotal","Tax","Total"];
  const rows: string[] = [];
  for (const b of bills) {
    rows.push(csvRow([
      b.billedAt.slice(0, 10),
      b.isRefund ? "Refund" : "Sale",
      b.billNo, b.customerName,
      (b.subtotalPaise as number) / 100,
      ((b.cgstPaise as number) + (b.sgstPaise as number) + (b.igstPaise as number) + (b.cessPaise as number)) / 100,
      (b.totalPaise as number) / 100,
    ]));
  }
  for (const p of purchases) {
    rows.push(csvRow([
      p.invoiceDate.slice(0, 10),
      "Purchase",
      p.invoiceNo, p.supplierName,
      (p.subtotalPaise as number) / 100,
      ((p.cgstPaise as number) + (p.sgstPaise as number) + (p.igstPaise as number) + (p.cessPaise as number)) / 100,
      (p.totalPaise as number) / 100,
    ]));
  }
  // Sort by date asc
  rows.sort();
  return [header.join(","), ...rows].join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Trial Balance + P&L + Balance Sheet (for LLP Form 8)
// ────────────────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  readonly account: string;
  readonly openingPaise: Paise;
  readonly debitPaise: Paise;
  readonly creditPaise: Paise;
  readonly closingPaise: Paise;
}

export interface ProfitLoss {
  readonly revenuePaise: Paise;
  readonly cogsPaise: Paise;            // cost of goods sold
  readonly grossProfitPaise: Paise;
  readonly operatingExpensesPaise: Paise;
  readonly netProfitPaise: Paise;
  readonly expenseBreakdown: Readonly<Record<string, Paise>>;
}

export interface BalanceSheet {
  readonly assets: {
    readonly cashAndBankPaise: Paise;
    readonly inventoryPaise: Paise;
    readonly receivablesPaise: Paise;     // khata current dues
    readonly fixedAssetsPaise: Paise;
    readonly totalPaise: Paise;
  };
  readonly liabilities: {
    readonly payablesPaise: Paise;        // unpaid GRNs
    readonly partnersCapitalPaise: Paise;
    readonly retainedEarningsPaise: Paise;
    readonly totalPaise: Paise;
  };
  readonly balanced: boolean;             // assets - liabilities ≈ 0 (tolerance 1 paisa)
}

export interface LlpFormInputs {
  readonly llpRegNo?: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly partners: readonly PartnerInfo[];
  readonly profitLoss: ProfitLoss;
  readonly balanceSheet: BalanceSheet;
  readonly solvencyDeclaration: {
    readonly ableToMeetDebts: boolean;
    readonly noticeOfRegistration?: string;
  };
}

export function computeProfitLoss(args: {
  readonly bills: readonly BillRow[];           // sales (and refunds)
  readonly purchases: readonly PurchaseRow[];    // COGS proxy
  readonly expenses: readonly ExpenseRow[];
}): ProfitLoss {
  const sales = args.bills.filter((b) => !b.isRefund);
  const refunds = args.bills.filter((b) => b.isRefund);
  const revenue = sales.reduce((s, b) => s + (b.subtotalPaise as number), 0)
                - refunds.reduce((s, b) => s + (b.subtotalPaise as number), 0);
  const cogs = args.purchases.reduce((s, p) => s + (p.subtotalPaise as number), 0);
  const grossProfit = revenue - cogs;
  const opEx = args.expenses.reduce((s, e) => s + (e.amountPaise as number), 0);
  const expenseBreakdown: Record<string, number> = {};
  for (const e of args.expenses) {
    expenseBreakdown[e.account] = (expenseBreakdown[e.account] ?? 0) + (e.amountPaise as number);
  }
  const netProfit = grossProfit - opEx;
  return {
    revenuePaise: paise(revenue),
    cogsPaise: paise(cogs),
    grossProfitPaise: paise(grossProfit),
    operatingExpensesPaise: paise(opEx),
    netProfitPaise: paise(netProfit),
    expenseBreakdown: Object.fromEntries(
      Object.entries(expenseBreakdown).map(([k, v]) => [k, paise(v)]),
    ) as Readonly<Record<string, Paise>>,
  };
}

export function buildProfitLossCsv(p: ProfitLoss, periodLabel: string): string {
  const lines: string[] = [];
  lines.push(`Profit & Loss Statement,${periodLabel}`);
  lines.push("");
  lines.push("Item,Amount (₹)");
  lines.push(csvRow(["Revenue", (p.revenuePaise as number) / 100]));
  lines.push(csvRow(["less: COGS", (p.cogsPaise as number) / 100]));
  lines.push(csvRow(["Gross Profit", (p.grossProfitPaise as number) / 100]));
  lines.push(csvRow(["less: Operating Expenses", (p.operatingExpensesPaise as number) / 100]));
  for (const [acct, amt] of Object.entries(p.expenseBreakdown)) {
    lines.push(csvRow([`  ${acct}`, (amt as number) / 100]));
  }
  lines.push(csvRow(["Net Profit / (Loss)", (p.netProfitPaise as number) / 100]));
  return lines.join("\n");
}

export function buildBalanceSheetCsv(bs: BalanceSheet, periodLabel: string): string {
  const lines: string[] = [];
  lines.push(`Balance Sheet,as at ${periodLabel}`);
  lines.push("");
  lines.push("ASSETS,Amount (₹)");
  lines.push(csvRow(["Cash and Bank", (bs.assets.cashAndBankPaise as number) / 100]));
  lines.push(csvRow(["Inventory (stock-on-hand)", (bs.assets.inventoryPaise as number) / 100]));
  lines.push(csvRow(["Receivables (khata)", (bs.assets.receivablesPaise as number) / 100]));
  lines.push(csvRow(["Fixed Assets", (bs.assets.fixedAssetsPaise as number) / 100]));
  lines.push(csvRow(["Total Assets", (bs.assets.totalPaise as number) / 100]));
  lines.push("");
  lines.push("LIABILITIES + CAPITAL,Amount (₹)");
  lines.push(csvRow(["Payables (unpaid GRNs)", (bs.liabilities.payablesPaise as number) / 100]));
  lines.push(csvRow(["Partners' Capital", (bs.liabilities.partnersCapitalPaise as number) / 100]));
  lines.push(csvRow(["Retained Earnings", (bs.liabilities.retainedEarningsPaise as number) / 100]));
  lines.push(csvRow(["Total Liabilities + Capital", (bs.liabilities.totalPaise as number) / 100]));
  lines.push("");
  lines.push(csvRow(["Balanced?", bs.balanced ? "YES" : "NO — investigate before LLP Form 8 filing"]));
  return lines.join("\n");
}

export function buildTrialBalanceCsv(rows: readonly TrialBalanceRow[]): string {
  const header = ["Account","Opening (₹)","Debit (₹)","Credit (₹)","Closing (₹)"];
  const out = rows.map((r) => csvRow([
    r.account,
    (r.openingPaise as number) / 100,
    (r.debitPaise as number) / 100,
    (r.creditPaise as number) / 100,
    (r.closingPaise as number) / 100,
  ]));
  return [header.join(","), ...out].join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Bundle assembly
// ────────────────────────────────────────────────────────────────────────

export interface BuildBundleArgs {
  readonly shopName: string;
  readonly shopGstin: string;
  /** Drives which compliance file groups are included (LLP Form 8 vs AOC-4 etc). */
  readonly entityType: EntityType;
  /** Optional registration numbers — only relevant per entity type. */
  readonly llpRegNo?: string;       // LLP only
  readonly cinNumber?: string;      // OPC / Pvt Ltd / Public Ltd / Section 8
  readonly period: string;          // "2026-04" or "FY2025-26"
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly bills: readonly BillRow[];
  readonly purchases: readonly PurchaseRow[];
  readonly cashBookRows: readonly CashRow[];
  readonly expenses: readonly ExpenseRow[];
  readonly trialBalance: readonly TrialBalanceRow[];
  readonly balanceSheet: BalanceSheet;
  readonly partners: readonly PartnerInfo[];
  /** Portal-downloaded GSTR-2B for reconciliation. Optional. */
  readonly gstr2bPortalRows?: readonly Gstr2bPortalRow[];
}

export function buildCABundle(a: BuildBundleArgs): CABundle {
  const files: BundleFile[] = [];

  // GST monthly (skip if FY-wide)
  const isFy = a.period.startsWith("FY");

  if (!isFy) {
    files.push({
      name: `gstr1_${a.period}.json`,
      content: JSON.stringify({ gstr1: { period: a.period, shopGstin: a.shopGstin, bills: a.bills.map((b) => ({ billNo: b.billNo, billedAt: b.billedAt, customerGstin: b.customerGstin, totalPaise: b.totalPaise })) } }, null, 2),
      mime: "application/json", purpose: "GSTR-1 outward supplies — direct portal upload",
      forForm: "GSTR-1",
    });

    const adapted: Gstr3bBillRow[] = a.bills.map((b) => ({
      billId: b.billId, billNo: b.billNo, billedAt: b.billedAt,
      customerStateCode: b.customerStateCode,
      taxablePaise: b.subtotalPaise, cgstPaise: b.cgstPaise, sgstPaise: b.sgstPaise,
      igstPaise: b.igstPaise, cessPaise: b.cessPaise, isRefund: b.isRefund,
    }));
    const adaptedP: Gstr3bPurchaseRow[] = a.purchases.map((p) => ({
      grnId: p.grnId, invoiceNo: p.invoiceNo, invoiceDate: p.invoiceDate,
      supplierGstin: p.supplierGstin,
      taxablePaise: p.subtotalPaise, cgstPaise: p.cgstPaise, sgstPaise: p.sgstPaise,
      igstPaise: p.igstPaise, cessPaise: p.cessPaise, itcEligible: p.itcEligible,
    }));
    const r3b = buildGstr3b({ period: a.period, shopId: a.shopGstin, bills: adapted, purchases: adaptedP });
    files.push({
      name: `gstr3b_${a.period}.json`,
      content: JSON.stringify(r3b, null, 2),
      mime: "application/json", purpose: "GSTR-3B summary — for CA review + portal upload",
      forForm: "GSTR-3B",
    });

    if (a.gstr2bPortalRows && a.gstr2bPortalRows.length > 0) {
      const recon = reconcile2b(adaptedP, a.gstr2bPortalRows);
      const reconCsv = ["Supplier GSTIN,Invoice No,Status,Our Taxable,Portal Taxable,Diff,Notes",
        ...recon.map((r) => csvRow([r.supplierGstin, r.invoiceNo, r.status,
          r.ourTaxablePaise !== undefined ? (r.ourTaxablePaise as number) / 100 : "",
          r.portalTaxablePaise !== undefined ? (r.portalTaxablePaise as number) / 100 : "",
          r.diffPaise !== undefined ? (r.diffPaise as number) / 100 : "",
          r.notes ?? ""]))].join("\n");
      files.push({
        name: `gstr2b_recon_${a.period}.csv`,
        content: reconCsv, mime: "text/csv",
        purpose: "GSTR-2B reconciliation — flags missing / mismatched supplier filings (ITC risk)",
        forForm: "GSTR-2B",
      });
    }

    files.push({
      name: `sales_register_${a.period}.csv`,
      content: buildSalesRegisterCsv(a.bills),
      mime: "text/csv",
      purpose: "Sales register — every bill with HSN, GST split, customer GSTIN. CA imports into accounting tool.",
      forForm: "GSTR-1",
    });

    files.push({
      name: `purchase_register_${a.period}.csv`,
      content: buildPurchaseRegisterCsv(a.purchases),
      mime: "text/csv",
      purpose: "Purchase register — every GRN with supplier GSTIN, ITC-eligible flag. Reconcile against GSTR-2B.",
      forForm: "GSTR-2B",
    });

    files.push({
      name: `hsn_summary_${a.period}.csv`,
      content: buildHsnSummaryCsv(a.bills),
      mime: "text/csv",
      purpose: "HSN-wise tax aggregate. Required section of GSTR-1.",
      forForm: "GSTR-1",
    });

    files.push({
      name: `cash_book_${a.period}.csv`,
      content: buildCashBookCsv(a.cashBookRows),
      mime: "text/csv",
      purpose: "Cash book — date-wise inflow/outflow with running balance.",
      forForm: "Pharmacy Records",
    });

    files.push({
      name: `day_book_${a.period}.csv`,
      content: buildDayBookCsv(a.bills, a.purchases),
      mime: "text/csv",
      purpose: "Day book — sales + purchases interleaved by date.",
      forForm: "Pharmacy Records",
    });

    // Tally / Zoho / QB adapters
    const vouchers: TallyVoucher[] = a.bills.filter((b) => !b.isRefund).map((b) =>
      billToSalesVoucher({
        billNo: b.billNo, billedAt: b.billedAt,
        customerLedgerName: b.customerName,
        grandTotalPaise: b.totalPaise,
        cgstPaise: b.cgstPaise, sgstPaise: b.sgstPaise,
        igstPaise: b.igstPaise, cessPaise: b.cessPaise,
        salesLedgerName: "Sales — Pharmacy",
      })
    );
    files.push({
      name: `tally_prime_${a.period}.xml`,
      content: buildTallyXml(vouchers, a.shopName),
      mime: "application/xml",
      purpose: "Tally Prime XML — direct voucher import (Gateway → Import → Vouchers).",
      forForm: "Tally Import",
    });
    files.push({
      name: `zoho_books_${a.period}.csv`,
      content: buildZohoBooksCsv(vouchers),
      mime: "text/csv",
      purpose: "Zoho Books invoice CSV — Settings → Import → Invoices.",
      forForm: "Zoho Import",
    });
    files.push({
      name: `quickbooks_${a.period}.iif`,
      content: buildQuickBooksIIF(vouchers),
      mime: "text/plain",
      purpose: "QuickBooks IIF — File → Utilities → Import → IIF Files.",
      forForm: "QuickBooks Import",
    });
  }

  // Entity-driven file inclusion: each compliance group only emits when applicable.
  const groups = new Set<ComplianceFileGroup>(complianceGroupsFor(a.entityType));

  // LLP-annual files — only when entity has LLP filings
  const pl = computeProfitLoss({ bills: a.bills, purchases: a.purchases, expenses: a.expenses });
  files.push({
    name: `profit_loss_${a.period}.csv`,
    content: buildProfitLossCsv(pl, a.period),
    mime: "text/csv",
    purpose: "P&L — required input to LLP Form 8 Part B (Statement of Income & Expenditure).",
    forForm: "LLP Form 8",
  });

  files.push({
    name: `balance_sheet_${a.period}.csv`,
    content: buildBalanceSheetCsv(a.balanceSheet, a.periodEnd),
    mime: "text/csv",
    purpose: "Balance sheet — required input to LLP Form 8 Part B.",
    forForm: "LLP Form 8",
  });

  files.push({
    name: `trial_balance_${a.period}.csv`,
    content: buildTrialBalanceCsv(a.trialBalance),
    mime: "text/csv",
    purpose: "Trial balance — CA reviews before signing P&L + BS for Form 8.",
    forForm: "LLP Form 8",
  });

  // LLP Form 8 inputs JSON — only when entity is LLP
  if (groups.has("llp_form_8_11")) {
    const llpFormInputs: LlpFormInputs = {
      ...(a.llpRegNo !== undefined ? { llpRegNo: a.llpRegNo } : {}),
      periodStart: a.periodStart, periodEnd: a.periodEnd,
      partners: a.partners,
      profitLoss: pl,
      balanceSheet: a.balanceSheet,
      solvencyDeclaration: { ableToMeetDebts: a.balanceSheet.balanced && (pl.netProfitPaise as number) >= 0 },
    };
    files.push({
      name: `llp_form8_inputs_${a.period}.json`,
      content: JSON.stringify(llpFormInputs, null, 2),
      mime: "application/json",
      purpose: "LLP Form 8 input bundle — CA pre-fills MCA portal Form 8 fields.",
      forForm: "LLP Form 8",
    });
  }

  // Pvt Ltd / Public Ltd / Section 8 — AOC-4 + MGT-7 input JSON
  if (groups.has("company_aoc_mgt")) {
    files.push({
      name: `aoc4_inputs_${a.period}.json`,
      content: JSON.stringify({
        cinNumber: a.cinNumber, periodStart: a.periodStart, periodEnd: a.periodEnd,
        directors: a.partners,            // we re-use partners list as directors for the bundle
        profitLoss: pl, balanceSheet: a.balanceSheet,
      }, null, 2),
      mime: "application/json",
      purpose: "AOC-4 (Financial Statements) input bundle for MCA portal.",
      forForm: "ITR-5",   // closest to the company filings — caller re-routes
    });
    files.push({
      name: `mgt7_inputs_${a.period}.json`,
      content: JSON.stringify({
        cinNumber: a.cinNumber, periodEnd: a.periodEnd,
        directors: a.partners,
      }, null, 2),
      mime: "application/json",
      purpose: "MGT-7 (Annual Return) input bundle for MCA portal.",
      forForm: "ITR-5",
    });
  }

  // OPC — AOC-4 + MGT-7A (small-co variant)
  if (groups.has("opc_aoc_mgt")) {
    files.push({
      name: `aoc4_opc_inputs_${a.period}.json`,
      content: JSON.stringify({
        cinNumber: a.cinNumber, periodStart: a.periodStart, periodEnd: a.periodEnd,
        director: a.partners[0],
        profitLoss: pl, balanceSheet: a.balanceSheet,
      }, null, 2),
      mime: "application/json",
      purpose: "AOC-4 (OPC variant) input bundle for MCA portal.",
      forForm: "ITR-5",
    });
    files.push({
      name: `mgt7a_inputs_${a.period}.json`,
      content: JSON.stringify({
        cinNumber: a.cinNumber, periodEnd: a.periodEnd,
        director: a.partners[0],
      }, null, 2),
      mime: "application/json",
      purpose: "MGT-7A (Annual Return - small/OPC) input bundle for MCA portal.",
      forForm: "ITR-5",
    });
  }

  // README
  files.push({
    name: `README.md`,
    content: buildReadme(a, files.length, groups),
    mime: "text/markdown",
    purpose: "Cover page — what's in the bundle, how to use each file.",
    forForm: "Pharmacy Records",
  });

  return {
    shopName: a.shopName,
    shopGstin: a.shopGstin,
    ...(a.llpRegNo !== undefined ? { llpRegNo: a.llpRegNo } : {}),
    period: a.period,
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    generatedAt: new Date().toISOString(),
    files,
  };
}

function buildReadme(a: BuildBundleArgs, fileCount: number, groups: ReadonlySet<ComplianceFileGroup>): string {
  return `# CA Export Bundle — ${a.shopName}

**Period**: ${a.period} (${a.periodStart} → ${a.periodEnd})
**Shop GSTIN**: ${a.shopGstin}
${a.llpRegNo ? `**LLP Reg No**: ${a.llpRegNo}\n` : ""}**Generated**: ${new Date().toISOString()}
**Files**: ${fileCount}

**Entity type**: ${ENTITY_TYPES[a.entityType].displayName}\n\n## How to use this bundle

| File | When | What CA does |
|---|---|---|
| \`gstr1_*.json\` | Monthly by 11th | Upload to GSTN portal → Returns → GSTR-1 → Import JSON |
| \`gstr3b_*.json\` | Monthly by 20th | Reference for portal entry — review then file |
| \`gstr2b_recon_*.csv\` | Monthly | Review mismatches; chase suppliers for missing invoices |
| \`sales_register_*.csv\` | Always | Audit trail; CA imports into Tally / Zoho / books |
| \`purchase_register_*.csv\` | Always | Same — also for ITC reconciliation |
| \`hsn_summary_*.csv\` | Monthly | HSN section of GSTR-1 |
| \`cash_book_*.csv\` | Daily | Bank reconciliation reference |
| \`day_book_*.csv\` | Daily | Books of accounts (Section 44AA Income Tax Act) |
| \`tally_prime_*.xml\` | Anytime | Tally → Gateway → Import → Vouchers |
| \`zoho_books_*.csv\` | Anytime | Zoho → Settings → Import → Invoices |
| \`quickbooks_*.iif\` | Anytime | QuickBooks → File → Utilities → Import → IIF |
| \`profit_loss_*.csv\` | Annual (LLP Form 8) | P&L for Statement of Income & Expenditure |
| \`balance_sheet_*.csv\` | Annual (LLP Form 8) | Balance sheet for Statement of Solvency |
| \`trial_balance_*.csv\` | Annual | CA verifies P&L + BS against trial balance |
| \`llp_form8_inputs_*.json\` | Annual by 30 Oct | Pre-filled fields for MCA portal Form 8 |

${groups.has("llp_form_8_11") ? `## LLP filing schedule (next FY)\n\n- **Form 11** (Annual Return — partner data, contributions): due **30 May**\n- **Form 8** (Statement of Account & Solvency): due **30 October**\n- **DIR-3 KYC** (designated partners): due **30 September**\n- **ITR-5**: per income-tax due dates` : ""}${groups.has("company_aoc_mgt") ? `## Company filing schedule (next FY)\n\n- **AOC-4** (Financial Statements): within 30 days of AGM (typ. 30 Oct)\n- **MGT-7** (Annual Return): within 60 days of AGM (typ. 28 Nov)\n- **DIR-3 KYC**: 30 September\n- **ITR-6**: per income-tax due dates` : ""}${groups.has("opc_aoc_mgt") ? `## OPC filing schedule (next FY)\n\n- **AOC-4 (OPC)**: 27 September (6 months from FY end)\n- **MGT-7A**: 28 November\n- **DIR-3 KYC**: 30 September\n- **ITR-6**: per income-tax due dates` : ""}${!groups.has("llp_form_8_11") && !groups.has("company_aoc_mgt") && !groups.has("opc_aoc_mgt") ? `## Filing schedule (next FY)\n\nNo ROC filings required for this entity type. Just GST + Income Tax.` : ""}
- **GSTR-1** monthly: 11th of next month
- **GSTR-3B** monthly: 20th of next month

## Generated by Rasayn (PharmaCare Pro) — Standalone, no cloud dependency.
`;
}

// Convenience: pure file-by-file iteration (caller zips client-side)
export function fileEntries(b: CABundle): ReadonlyArray<{ name: string; content: string; mime: string }> {
  return b.files.map((f) => ({ name: f.name, content: f.content, mime: f.mime }));
}
