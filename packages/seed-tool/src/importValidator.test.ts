import { describe, expect, it } from "vitest";
import {
  validateImportCsv,
  renderMarkdownReport,
  MARG_COLUMN_MAP,
  TALLY_COLUMN_MAP,
  type ImportColumnMap,
} from "./importValidator.js";

const TODAY = "2026-04-27";

function csv(...lines: string[]): string {
  return lines.join("\n") + "\n";
}

describe("validateImportCsv — happy path", () => {
  it("accepts a clean Marg-style row with all required columns", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin 500 Tab,GSK,30049099,12%,OTC,BX1,12/2027,100,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.summary.errorCount).toBe(0);
    expect(r.summary.cleanRowCount).toBe(1);
    expect(r.cleanRows[0]?.productName).toBe("Crocin 500 Tab");
    expect(r.cleanRows[0]?.gstRate).toBe("12");
    expect(r.cleanRows[0]?.mrpPaise).toBe("4200");
  });

  it("Tally column map works against Tally-style headers", () => {
    const c = csv(
      "Particulars,Manufacturer,HSN/SAC,Tax Rate,Schedule,Batch,Expiry Date,Closing Qty,Rate",
      "Crocin 500,GSK,30049099,12,OTC,BX1,2027-12-31,100,42.00",
    );
    const r = validateImportCsv(c, TALLY_COLUMN_MAP, { today: TODAY });
    expect(r.summary.errorCount).toBe(0);
    expect(r.cleanRows[0]?.productName).toBe("Crocin 500");
  });
});

describe("validateImportCsv — header errors", () => {
  it("aborts when required column is missing", () => {
    const c = csv("Item Name,Mfg.,HSN,GST %,Batch No.,Expiry,Qty");
    // Missing MRP column
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.summary.errorCount).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.code === "ROW_PARSE_FAILED")).toBe(true);
    expect(r.cleanRows.length).toBe(0);
  });
});

describe("validateImportCsv — row-level errors", () => {
  it("flags HSN that doesn't start with a pharma prefix", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Iodex,Reckitt,33049200,12,OTC,BX2,12/2027,10,80.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.findings.some((f) => f.code === "HSN_NOT_PHARMA")).toBe(true);
    expect(r.summary.errorCount).toBeGreaterThan(0);
  });

  it("flags invalid GST rate (e.g. 7%)", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Vitamin D3,Sun Pharma,30049099,7,OTC,BX3,12/2027,5,200.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.findings.some((f) => f.code === "GST_RATE_INVALID")).toBe(true);
  });

  it("flags missing batch / expiry as errors", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,OTC,,,10,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.findings.some((f) => f.code === "BATCH_EMPTY")).toBe(true);
    expect(r.findings.some((f) => f.code === "EXPIRY_EMPTY")).toBe(true);
    expect(r.summary.cleanRowCount).toBe(0);
  });

  it("flags non-positive qty as warn (not error) — stock-out at export time", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,OTC,BX1,12/2027,0,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.summary.warnCount).toBe(1);
    expect(r.summary.errorCount).toBe(0);
    expect(r.findings.some((f) => f.code === "QTY_NON_POSITIVE")).toBe(true);
    // Row still imports because qty=0 is not a hard error.
    expect(r.summary.cleanRowCount).toBe(1);
  });

  it("flags negative MRP / unparseable MRP as error", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,OTC,BX1,12/2027,10,-50",
      "Dolo,Micro Labs,30049099,12,OTC,BX2,12/2027,10,abc",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    const codes = r.findings.map((f) => f.code);
    expect(codes.filter((c) => c === "MRP_NON_POSITIVE").length).toBe(2);
    expect(r.summary.cleanRowCount).toBe(0);
  });

  it("expired batches are warn-not-error so owner can quarantine consciously", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,OTC,BX-OLD,01/2024,5,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.findings.some((f) => f.code === "EXPIRY_PAST")).toBe(true);
    expect(r.summary.warnCount).toBe(1);
    expect(r.summary.errorCount).toBe(0);
    expect(r.summary.cleanRowCount).toBe(1);
  });

  it("duplicate batch on same product flagged as warn (not error)", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,OTC,BX1,12/2027,10,42.00",
      "Crocin,GSK,30049099,12,OTC,BX1,12/2027,5,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.findings.some((f) => f.code === "DUPLICATE_BATCH")).toBe(true);
    expect(r.summary.warnCount).toBe(1);
    expect(r.summary.cleanRowCount).toBe(2); // both still pass
  });
});

describe("validateImportCsv — schedule handling", () => {
  it("rejects unknown schedule by default", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,Z,BX1,12/2027,10,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.findings.some((f) => f.code === "SCHEDULE_INVALID" && f.severity === "error")).toBe(true);
  });

  it("downgrades to warn + defaults to OTC when defaultScheduleToOtc=true", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,Z,BX1,12/2027,10,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY, defaultScheduleToOtc: true });
    expect(r.findings.some((f) => f.code === "SCHEDULE_INVALID" && f.severity === "warn")).toBe(true);
    expect(r.cleanRows[0]?.schedule).toBe("OTC");
  });
});

describe("validateImportCsv — date parsing", () => {
  it("accepts YYYY-MM-DD / DD/MM/YYYY / MM/YYYY", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "A,X,30049099,12,OTC,B1,2027-12-31,1,1.00",
      "B,X,30049099,12,OTC,B2,31/12/2027,1,1.00",
      "C,X,30049099,12,OTC,B3,12/2027,1,1.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.summary.errorCount).toBe(0);
    expect(r.summary.cleanRowCount).toBe(3);
  });
});

describe("CSV parser edge cases", () => {
  it("handles quoted fields containing commas", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      `"Crocin 500, syrup",GSK,30049099,12,OTC,BX1,12/2027,10,42.00`,
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.cleanRows[0]?.productName).toBe("Crocin 500, syrup");
  });

  it("handles ₹ prefix and commas in MRP", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      `Crocin,GSK,30049099,12,OTC,BX1,12/2027,10,"₹1,250.00"`,
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.summary.cleanRowCount).toBe(1);
    expect(r.cleanRows[0]?.mrpPaise).toBe("125000");
  });

  it("ignores blank trailing rows", () => {
    const c = "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP\nCrocin,GSK,30049099,12,OTC,BX1,12/2027,10,42.00\n\n\n";
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    expect(r.summary.totalRows).toBe(1);
  });
});

describe("renderMarkdownReport", () => {
  it("emits a complete markdown report for owner review", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,OTC,BX1,12/2027,10,42.00",
      "Iodex,Reckitt,33049200,12,OTC,BX2,12/2027,10,80.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    const md = renderMarkdownReport(r, "Marg export 2026-04-27");
    expect(md).toMatch(/Import-validator report/);
    expect(md).toMatch(/Marg export 2026-04-27/);
    expect(md).toMatch(/HSN_NOT_PHARMA/);
    // Summary table includes counts.
    expect(md).toMatch(/Total rows.*\| 2/);
    // Findings table header.
    expect(md).toMatch(/\| Row \| Column \|/);
  });

  it("clean import returns 'No findings'", () => {
    const c = csv(
      "Item Name,Mfg.,HSN,GST %,Schedule,Batch No.,Expiry,Qty,MRP",
      "Crocin,GSK,30049099,12,OTC,BX1,12/2027,10,42.00",
    );
    const r = validateImportCsv(c, MARG_COLUMN_MAP, { today: TODAY });
    const md = renderMarkdownReport(r, "clean export");
    expect(md).toMatch(/No findings/);
  });
});

describe("custom column map", () => {
  it("accepts arbitrary header naming with custom ImportColumnMap", () => {
    const custom: ImportColumnMap = {
      productName: "drug_name",
      manufacturer: "mfr",
      hsn: "hsn_code",
      gstRate: "gst",
      batchNo: "batch",
      expiry: "exp",
      qty: "stock",
      mrp: "price",
    };
    const c = csv(
      "drug_name,mfr,hsn_code,gst,batch,exp,stock,price",
      "Crocin,GSK,30049099,12,BX1,12/2027,10,42.00",
    );
    const r = validateImportCsv(c, custom, { today: TODAY });
    expect(r.summary.cleanRowCount).toBe(1);
  });
});
