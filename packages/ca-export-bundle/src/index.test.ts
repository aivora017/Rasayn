import { describe, it, expect } from "vitest";
import {
  escapeCsv, buildSalesRegisterCsv, buildPurchaseRegisterCsv, buildHsnSummaryCsv,
  buildCashBookCsv, buildDayBookCsv, buildTrialBalanceCsv,
  computeProfitLoss, buildProfitLossCsv, buildBalanceSheetCsv,
  buildCABundle, fileEntries,
  type BillRow, type PurchaseRow, type CashRow, type ExpenseRow,
  type TrialBalanceRow, type BalanceSheet, type PartnerInfo,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

const sampleBill = (overrides: Partial<BillRow> = {}): BillRow => ({
  billId: "b1", billNo: "B-001", billedAt: "2026-04-15T11:00:00Z",
  customerName: "Walk-in", customerStateCode: "27",
  subtotalPaise: paise(10000), cgstPaise: paise(250), sgstPaise: paise(250),
  igstPaise: paise(0), cessPaise: paise(0), totalPaise: paise(10500),
  isRefund: false,
  hsnLines: [{ hsn: "30049099", taxableValuePaise: paise(10000), gstRate: 5 }],
  ...overrides,
});
const samplePurchase = (overrides: Partial<PurchaseRow> = {}): PurchaseRow => ({
  grnId: "g1", invoiceNo: "INV-101", invoiceDate: "2026-04-10",
  supplierName: "Pharmarack", supplierGstin: "27ABCDE1234F1Z5",
  subtotalPaise: paise(5000), cgstPaise: paise(125), sgstPaise: paise(125),
  igstPaise: paise(0), cessPaise: paise(0), totalPaise: paise(5250),
  itcEligible: true,
  ...overrides,
});
const sampleBs = (overrides: Partial<BalanceSheet> = {}): BalanceSheet => ({
  assets: { cashAndBankPaise: paise(50000), inventoryPaise: paise(200000), receivablesPaise: paise(20000), fixedAssetsPaise: paise(30000), totalPaise: paise(300000) },
  liabilities: { payablesPaise: paise(50000), partnersCapitalPaise: paise(200000), retainedEarningsPaise: paise(50000), totalPaise: paise(300000) },
  balanced: true,
  ...overrides,
});

describe("escapeCsv", () => {
  it("plain string passes through", () => { expect(escapeCsv("hello")).toBe("hello"); });
  it("escapes commas", () => { expect(escapeCsv("a,b")).toBe('"a,b"'); });
  it("escapes quotes (doubles them)", () => { expect(escapeCsv('he said "hi"')).toBe('"he said ""hi"""'); });
  it("escapes newlines", () => { expect(escapeCsv("a\nb")).toBe('"a\nb"'); });
  it("null / undefined → empty", () => {
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });
  it("numbers stringify", () => { expect(escapeCsv(123.45)).toBe("123.45"); });
});

describe("Sales register CSV", () => {
  it("emits header + one row per bill", () => {
    const csv = buildSalesRegisterCsv([sampleBill(), sampleBill({ billId: "b2", billNo: "B-002" })]);
    const rows = csv.split("\n");
    expect(rows[0]).toBe("Bill No,Date,Customer,Customer GSTIN,State Code,Subtotal,CGST,SGST,IGST,CESS,Total,Is Refund");
    expect(rows.length).toBe(3);
    expect(rows[1]).toContain("B-001");
  });
  it("rupees not paise (CA-friendly format)", () => {
    const csv = buildSalesRegisterCsv([sampleBill({ totalPaise: paise(10500) })]);
    expect(csv).toContain("105");           // 10500 paise = ₹105
    expect(csv).not.toContain("10500");      // shouldn't expose paise
  });
  it("isRefund column", () => {
    const csv = buildSalesRegisterCsv([sampleBill({ isRefund: true })]);
    expect(csv.split("\n")[1]).toContain(",Y");
  });
});

describe("Purchase register CSV", () => {
  it("includes ITC eligible flag", () => {
    const csv = buildPurchaseRegisterCsv([samplePurchase(), samplePurchase({ grnId: "g2", invoiceNo: "I2", itcEligible: false })]);
    const rows = csv.split("\n");
    expect(rows[1]).toContain(",Y");
    expect(rows[2]).toContain(",N");
  });
});

describe("HSN summary CSV", () => {
  it("aggregates by HSN code", () => {
    const csv = buildHsnSummaryCsv([
      sampleBill({ hsnLines: [{ hsn: "30049099", taxableValuePaise: paise(10000), gstRate: 5 }] }),
      sampleBill({ billId: "b2", hsnLines: [{ hsn: "30049099", taxableValuePaise: paise(20000), gstRate: 5 }] }),
      sampleBill({ billId: "b3", hsnLines: [{ hsn: "30049011", taxableValuePaise: paise(5000), gstRate: 5 }] }),
    ]);
    const rows = csv.split("\n");
    expect(rows.length).toBe(3);                 // header + 2 HSN rows
    const hsn099Row = rows.find((r) => r.startsWith("30049099"));
    expect(hsn099Row).toBeDefined();
  });
  it("sorted by HSN code asc", () => {
    const csv = buildHsnSummaryCsv([
      sampleBill({ hsnLines: [{ hsn: "30049099", taxableValuePaise: paise(100), gstRate: 5 }] }),
      sampleBill({ billId: "b2", hsnLines: [{ hsn: "30049011", taxableValuePaise: paise(100), gstRate: 5 }] }),
    ]);
    const rows = csv.split("\n").slice(1);
    expect(rows[0]?.startsWith("30049011")).toBe(true);
    expect(rows[1]?.startsWith("30049099")).toBe(true);
  });
  it("excludes refunds from HSN aggregation", () => {
    const csv = buildHsnSummaryCsv([
      sampleBill({ isRefund: true, hsnLines: [{ hsn: "30049099", taxableValuePaise: paise(99999999), gstRate: 5 }] }),
    ]);
    expect(csv.split("\n").length).toBe(1);   // header only
  });
});

describe("Cash book CSV", () => {
  it("emits running balance correctly", () => {
    const rows: CashRow[] = [
      { date: "2026-04-15", description: "Opening", cashInPaise: paise(50000), cashOutPaise: paise(0), mode: "cash", ref: "OB" },
      { date: "2026-04-15", description: "Sale 1", cashInPaise: paise(10000), cashOutPaise: paise(0), mode: "cash", ref: "B-001" },
      { date: "2026-04-15", description: "Bank deposit", cashInPaise: paise(0), cashOutPaise: paise(40000), mode: "cash", ref: "DEP" },
    ];
    const csv = buildCashBookCsv(rows);
    const dataRows = csv.split("\n").slice(1);
    expect(dataRows[0]).toContain("500"); // 50000 paise = ₹500 running
    expect(dataRows[2]).toContain("200"); // 50000+10000-40000 = 20000p = ₹200
  });
});

describe("Day book CSV", () => {
  it("interleaves sales + purchases sorted by date", () => {
    const csv = buildDayBookCsv(
      [sampleBill({ billedAt: "2026-04-20T10:00:00Z" })],
      [samplePurchase({ invoiceDate: "2026-04-15" })],
    );
    const rows = csv.split("\n").slice(1);
    expect(rows[0]).toContain("2026-04-15");
    expect(rows[0]).toContain("Purchase");
    expect(rows[1]).toContain("2026-04-20");
    expect(rows[1]).toContain("Sale");
  });
});

describe("computeProfitLoss", () => {
  it("revenue = sales − refunds (subtotal-basis)", () => {
    const pl = computeProfitLoss({
      bills: [sampleBill({ subtotalPaise: paise(20000) }), sampleBill({ billId: "b2", subtotalPaise: paise(5000), isRefund: true })],
      purchases: [samplePurchase({ subtotalPaise: paise(8000) })],
      expenses: [],
    });
    expect(pl.revenuePaise).toBe(paise(15000));
    expect(pl.cogsPaise).toBe(paise(8000));
    expect(pl.grossProfitPaise).toBe(paise(7000));
  });
  it("operating expenses + breakdown", () => {
    const pl = computeProfitLoss({
      bills: [sampleBill({ subtotalPaise: paise(50000) })],
      purchases: [samplePurchase({ subtotalPaise: paise(20000) })],
      expenses: [
        { date: "2026-04-01", account: "Rent",        amountPaise: paise(15000), hasGstInput: false },
        { date: "2026-04-05", account: "Salaries",    amountPaise: paise(8000),  hasGstInput: false },
        { date: "2026-04-10", account: "Electricity", amountPaise: paise(2000),  hasGstInput: true, gstInputPaise: paise(360) },
      ],
    });
    expect(pl.operatingExpensesPaise).toBe(paise(25000));
    expect(pl.netProfitPaise).toBe(paise(50000 - 20000 - 25000));
    expect(pl.expenseBreakdown["Rent"]).toBe(paise(15000));
    expect(pl.expenseBreakdown["Salaries"]).toBe(paise(8000));
    expect(pl.expenseBreakdown["Electricity"]).toBe(paise(2000));
  });
  it("net loss when expenses > gross profit", () => {
    const pl = computeProfitLoss({
      bills: [sampleBill({ subtotalPaise: paise(10000) })],
      purchases: [samplePurchase({ subtotalPaise: paise(8000) })],
      expenses: [{ date: "2026-04-01", account: "Rent", amountPaise: paise(5000), hasGstInput: false }],
    });
    expect(pl.netProfitPaise).toBe(paise(-3000));
  });
});

describe("buildProfitLossCsv", () => {
  it("includes Net Profit / (Loss) line + expense breakdown", () => {
    const pl = computeProfitLoss({
      bills: [sampleBill({ subtotalPaise: paise(100000) })],
      purchases: [samplePurchase({ subtotalPaise: paise(40000) })],
      expenses: [{ date: "2026-04-01", account: "Rent", amountPaise: paise(20000), hasGstInput: false }],
    });
    const csv = buildProfitLossCsv(pl, "2026-04");
    expect(csv).toContain("Net Profit");
    expect(csv).toContain("Rent");
  });
});

describe("buildBalanceSheetCsv", () => {
  it("flags balanced / not-balanced", () => {
    const csv = buildBalanceSheetCsv(sampleBs(), "2026-03-31");
    expect(csv).toContain("Balanced?");
    expect(csv).toContain("YES");
  });
  it("emits warning when not balanced", () => {
    const csv = buildBalanceSheetCsv(sampleBs({ balanced: false }), "2026-03-31");
    expect(csv).toContain("NO");
    expect(csv).toContain("investigate");
  });
});

describe("buildTrialBalanceCsv", () => {
  it("emits header + one row per account", () => {
    const rows: TrialBalanceRow[] = [
      { account: "Cash",  openingPaise: paise(50000), debitPaise: paise(100000), creditPaise: paise(80000), closingPaise: paise(70000) },
      { account: "Sales", openingPaise: paise(0),     debitPaise: paise(0),      creditPaise: paise(100000), closingPaise: paise(-100000) },
    ];
    const csv = buildTrialBalanceCsv(rows);
    expect(csv.split("\n").length).toBe(3);
  });
});

describe("buildCABundle — orchestration", () => {
  const args = {
    shopName: "Jagannath Pharmacy LLP",
    shopGstin: "27ABCDE1234F1Z5",
    entityType: "llp" as const,
    llpRegNo: "AAA-1234",
    period: "2026-04",
    periodStart: "2026-04-01T00:00:00Z",
    periodEnd:   "2026-04-30T23:59:59Z",
    bills: [sampleBill()],
    purchases: [samplePurchase()],
    cashBookRows: [{ date: "2026-04-15", description: "Opening cash", cashInPaise: paise(50000), cashOutPaise: paise(0), mode: "cash" as const, ref: "OB" }],
    expenses: [{ date: "2026-04-01", account: "Rent", amountPaise: paise(15000), hasGstInput: false }] as ExpenseRow[],
    trialBalance: [{ account: "Cash", openingPaise: paise(0), debitPaise: paise(50000), creditPaise: paise(0), closingPaise: paise(50000) }] as TrialBalanceRow[],
    balanceSheet: sampleBs(),
    partners: [{ designatedPartnerId: "p1", name: "Sourav Shaw", contributionPaise: paise(100000) }] as PartnerInfo[],
  };

  it("includes monthly + LLP files for monthly period", () => {
    const b = buildCABundle(args);
    const names = b.files.map((f) => f.name);
    expect(names).toContain("gstr1_2026-04.json");
    expect(names).toContain("gstr3b_2026-04.json");
    expect(names).toContain("sales_register_2026-04.csv");
    expect(names).toContain("purchase_register_2026-04.csv");
    expect(names).toContain("hsn_summary_2026-04.csv");
    expect(names).toContain("cash_book_2026-04.csv");
    expect(names).toContain("day_book_2026-04.csv");
    expect(names).toContain("tally_prime_2026-04.xml");
    expect(names).toContain("zoho_books_2026-04.csv");
    expect(names).toContain("quickbooks_2026-04.iif");
    // LLP-annual files always present
    expect(names).toContain("profit_loss_2026-04.csv");
    expect(names).toContain("balance_sheet_2026-04.csv");
    expect(names).toContain("trial_balance_2026-04.csv");
    expect(names).toContain("llp_form8_inputs_2026-04.json");
    expect(names).toContain("README.md");
  });

  it("FY-period skips monthly GST files but keeps LLP files", () => {
    const fy = { ...args, period: "FY2026-27", periodStart: "2026-04-01", periodEnd: "2027-03-31" };
    const b = buildCABundle(fy);
    const names = b.files.map((f) => f.name);
    expect(names.some((n) => n.startsWith("gstr1_"))).toBe(false);
    expect(names).toContain("profit_loss_FY2026-27.csv");
    expect(names).toContain("llp_form8_inputs_FY2026-27.json");
  });

  it("fileEntries returns name+content+mime tuples for ZIP packing", () => {
    const b = buildCABundle(args);
    const entries = fileEntries(b);
    expect(entries.length).toBe(b.files.length);
    expect(entries[0]?.name).toBeTruthy();
    expect(entries[0]?.mime).toBeTruthy();
  });

  it("README mentions Jagannath + LLP filing schedule", () => {
    const b = buildCABundle(args);
    const readme = b.files.find((f) => f.name === "README.md")!;
    expect(readme.content).toContain("Jagannath");
    expect(readme.content).toContain("Form 8");
    expect(readme.content).toContain("Form 11");
    expect(readme.content).toContain("DIR-3 KYC");
  });

  it("LLP Form 8 inputs JSON has solvency declaration", () => {
    const b = buildCABundle(args);
    const f8 = b.files.find((f) => f.name === "llp_form8_inputs_2026-04.json")!;
    const parsed = JSON.parse(f8.content);
    expect(parsed.solvencyDeclaration).toBeDefined();
    expect(typeof parsed.solvencyDeclaration.ableToMeetDebts).toBe("boolean");
    expect(parsed.partners).toHaveLength(1);
  });
});

describe("entity-aware bundle composition", () => {
  const baseArgs = {
    shopName: "Test Pharmacy", shopGstin: "27AAAAA0000A1Z5",
    period: "2026-04", periodStart: "2026-04-01", periodEnd: "2026-04-30",
    bills: [sampleBill()], purchases: [samplePurchase()],
    cashBookRows: [], expenses: [], trialBalance: [], balanceSheet: sampleBs(), partners: [],
  };

  it("Sole proprietor → no LLP/Form 8/MGT-7 files", () => {
    const b = buildCABundle({ ...baseArgs, entityType: "sole_proprietor" });
    const names = b.files.map((f) => f.name);
    expect(names.some((n) => n.includes("llp_form8"))).toBe(false);
    expect(names.some((n) => n.includes("aoc4"))).toBe(false);
    expect(names.some((n) => n.includes("mgt7"))).toBe(false);
  });

  it("LLP → llp_form8_inputs is included", () => {
    const b = buildCABundle({ ...baseArgs, entityType: "llp", llpRegNo: "AAB-1234" });
    const names = b.files.map((f) => f.name);
    expect(names.some((n) => n.startsWith("llp_form8_inputs_"))).toBe(true);
    expect(names.some((n) => n.startsWith("aoc4_inputs_"))).toBe(false);   // not a company
  });

  it("Pvt Ltd → AOC-4 + MGT-7 inputs included, NOT LLP Form 8", () => {
    const b = buildCABundle({ ...baseArgs, entityType: "pvt_ltd", cinNumber: "U24230MH2020PTC123456" });
    const names = b.files.map((f) => f.name);
    expect(names.some((n) => n.startsWith("aoc4_inputs_"))).toBe(true);
    expect(names.some((n) => n.startsWith("mgt7_inputs_"))).toBe(true);
    expect(names.some((n) => n.startsWith("llp_form8_inputs_"))).toBe(false);
    expect(names.some((n) => n.includes("mgt7a"))).toBe(false);
  });

  it("OPC → MGT-7A (small variant) instead of MGT-7", () => {
    const b = buildCABundle({ ...baseArgs, entityType: "opc", cinNumber: "U24230MH2020OPC123456" });
    const names = b.files.map((f) => f.name);
    expect(names.some((n) => n.startsWith("aoc4_opc_inputs_"))).toBe(true);
    expect(names.some((n) => n.startsWith("mgt7a_inputs_"))).toBe(true);
    expect(names.some((n) => n.startsWith("mgt7_inputs_"))).toBe(false);
  });

  it("Partnership firm → no ROC files (only GST + ITR-5 paths)", () => {
    const b = buildCABundle({ ...baseArgs, entityType: "partnership_firm" });
    const names = b.files.map((f) => f.name);
    expect(names.some((n) => n.includes("aoc4") || n.includes("mgt7") || n.includes("llp_form8"))).toBe(false);
  });

  it("README mentions entity type in heading", () => {
    const b = buildCABundle({ ...baseArgs, entityType: "llp" });
    const readme = b.files.find((f) => f.name === "README.md")!;
    expect(readme.content).toContain("Limited Liability Partnership");
  });

  it("README schedule heading shows LLP for LLP entity", () => {
    const llp = buildCABundle({ ...baseArgs, entityType: "llp" });
    expect(llp.files.find((f) => f.name === "README.md")?.content).toContain("LLP filing schedule");
  });

  it("README schedule heading shows 'No ROC filings' for proprietor", () => {
    const prop = buildCABundle({ ...baseArgs, entityType: "sole_proprietor" });
    expect(prop.files.find((f) => f.name === "README.md")?.content).toContain("No ROC filings required");
  });

  it("README shows Company filing schedule for Pvt Ltd", () => {
    const ltd = buildCABundle({ ...baseArgs, entityType: "pvt_ltd", cinNumber: "U24230MH2020PTC123456" });
    expect(ltd.files.find((f) => f.name === "README.md")?.content).toContain("Company filing schedule");
  });

  it("README shows OPC filing schedule for OPC", () => {
    const opc = buildCABundle({ ...baseArgs, entityType: "opc", cinNumber: "U24230MH2020OPC123456" });
    expect(opc.files.find((f) => f.name === "README.md")?.content).toContain("OPC filing schedule");
  });
});

