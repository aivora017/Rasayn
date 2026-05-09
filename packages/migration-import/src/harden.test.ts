import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeHsn,
  hsnGstCoherent,
  normalizeScheduleClass,
  parseMargDate,
  isExpired,
  canonicalManufacturer,
  detectMfrDuplicates,
  adaptMargItemMasterCsvHardened,
  renderErrorReport,
} from "./harden.js";
import { parseCsv, parseRupeeToPaise } from "./index.js";

// Path to the synthetic master CSV the parallel agent A5 generates.
// Repo root → tools/synthetic-vaidyanath-master.csv. Resolved from this file
// (packages/migration-import/src/) by going up four levels.
const SYNTHETIC_MASTER = join(__dirname, "..", "..", "..", "tools", "synthetic-vaidyanath-master.csv");

describe("normalizeHsn", () => {
  it("trims whitespace", () => { expect(normalizeHsn("  30049099  ")).toBe("30049099"); });
  it("pads short numeric to 8", () => { expect(normalizeHsn("3004")).toBe("30040000"); });
  it("rejects non-numeric", () => { expect(normalizeHsn("HSN-XYZ")).toBe(""); });
  it("rejects too-short", () => { expect(normalizeHsn("12")).toBe(""); });
  it("accepts 8-digit", () => { expect(normalizeHsn("30049099")).toBe("30049099"); });
});

describe("hsnGstCoherent", () => {
  it("3004 + 12% ok", () => { expect(hsnGstCoherent("30049099", 12)).toBe(true); });
  it("3003 + 5% ok", () => { expect(hsnGstCoherent("30039011", 5)).toBe(true); });
  it("3004 + 28% flagged", () => { expect(hsnGstCoherent("30049099", 28)).toBe(false); });
  it("blank hsn → can't judge", () => { expect(hsnGstCoherent("", 0)).toBe(true); });
});

describe("normalizeScheduleClass", () => {
  it("empty → OTC", () => { expect(normalizeScheduleClass("")).toBe("OTC"); });
  it("blank-spaced → OTC", () => { expect(normalizeScheduleClass("   ")).toBe("OTC"); });
  it("h → H", () => { expect(normalizeScheduleClass("h")).toBe("H"); });
  it("H1 → H1", () => { expect(normalizeScheduleClass("H1")).toBe("H1"); });
  it("schedule x → X", () => { expect(normalizeScheduleClass("schedule x")).toBe("X"); });
  it("rejects unknown", () => { expect(() => normalizeScheduleClass("Z")).toThrow(/unknown/); });
});

describe("parseMargDate — all four real-world formats", () => {
  it("DD/MM/YYYY", () => { expect(parseMargDate("31/12/2024")).toBe("2024-12-31"); });
  it("DD-Mon-YYYY", () => { expect(parseMargDate("31-Dec-2024")).toBe("2024-12-31"); });
  it("DD/MM/YY (2-digit year)", () => { expect(parseMargDate("31/12/24")).toBe("2024-12-31"); });
  it("DD/MM/YY pre-2000", () => { expect(parseMargDate("31/12/85")).toBe("1985-12-31"); });
  it("DD.MM.YYYY", () => { expect(parseMargDate("31.12.2024")).toBe("2024-12-31"); });
  it("ISO passthrough", () => { expect(parseMargDate("2026-05-08")).toBe("2026-05-08"); });
  it("month-name case-insensitive", () => { expect(parseMargDate("01-jan-2027")).toBe("2027-01-01"); });
  it("month-slashes", () => { expect(parseMargDate("01-Jan-2027")).toBe("2027-01-01"); });
  it("rejects garbage with input echoed", () => {
    expect(() => parseMargDate("yesterday")).toThrow(/yesterday/);
  });
  it("rejects out-of-range month", () => {
    expect(() => parseMargDate("01/13/2024")).toThrow(/out-of-range/);
  });
});

describe("isExpired", () => {
  const today = new Date("2026-05-08T00:00:00Z");
  it("past → expired", () => { expect(isExpired("2024-01-01", today)).toBe(true); });
  it("today → not expired", () => { expect(isExpired("2026-05-08", today)).toBe(false); });
  it("future → not expired", () => { expect(isExpired("2027-01-01", today)).toBe(false); });
});

describe("canonicalManufacturer", () => {
  it("strips Ltd suffix", () => { expect(canonicalManufacturer("Cipla Ltd")).toBe("cipla"); });
  it("uppercase folds", () => { expect(canonicalManufacturer("CIPLA")).toBe("cipla"); });
  it("trims trailing whitespace", () => { expect(canonicalManufacturer("Cipla ")).toBe("cipla"); });
  it("strips Pharma suffix", () => { expect(canonicalManufacturer("Sun Pharma")).toBe("sun"); });
  it("groups Dr Reddy variants", () => {
    const a = canonicalManufacturer("Dr. Reddy's Labs");
    const b = canonicalManufacturer("Dr Reddys");
    expect(a).toBe(b);
  });
});

describe("detectMfrDuplicates", () => {
  it("groups Cipla variants", () => {
    const w = detectMfrDuplicates(["Cipla", "CIPLA", "Cipla Ltd"]);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/cipla/);
  });
  it("no group when only one variant", () => {
    expect(detectMfrDuplicates(["Cipla"])).toEqual([]);
  });
});

describe("parseRupeeToPaise — currency prefixes", () => {
  it("Rs. prefix", () => { expect(parseRupeeToPaise("Rs.123.45")).toBe(12345); });
  it("Rs prefix no dot", () => { expect(parseRupeeToPaise("Rs 1,234.50")).toBe(123450); });
  it("INR prefix", () => { expect(parseRupeeToPaise("INR 99.00")).toBe(9900); });
  it("rupee symbol still works", () => { expect(parseRupeeToPaise("₹1,234.50")).toBe(123450); });
});

describe("adaptMargItemMasterCsvHardened — synthetic Vaidyanath data", () => {
  it("imports the synthetic master CSV without crashing", () => {
    const csv = readFileSync(SYNTHETIC_MASTER, "utf8");
    const r = adaptMargItemMasterCsvHardened(csv, new Date("2026-05-08T00:00:00Z"));
    // No catastrophic crash → at least one product row.
    const products = r.source.rows.filter((x) => x.kind === "product");
    const batches = r.source.rows.filter((x) => x.kind === "batch");
    expect(products.length).toBeGreaterThan(450);
    expect(products.length).toBeLessThan(520);     // ≈500
    expect(batches.length).toBeGreaterThan(products.length);  // multi-batch dupes
    // Errors should be far fewer than total rows
    expect(r.errors.length).toBeLessThan(products.length / 5);
  });

  it("handles BOM + CRLF + Devanagari + currency prefix", () => {
    const csv = readFileSync(SYNTHETIC_MASTER, "utf8");
    const r = adaptMargItemMasterCsvHardened(csv);
    // At least one product name contains Devanagari (ट)
    const hasDeva = r.source.rows.some(
      (x) => x.kind === "product" && /[ऀ-ॿ]/.test(String(x.fields["name"] ?? "")),
    );
    expect(hasDeva).toBe(true);
    // All MRP prices are positive integers (paise)
    for (const row of r.source.rows.filter((x) => x.kind === "product")) {
      expect(typeof row.fields["mrpPaise"]).toBe("number");
      expect(row.fields["mrpPaise"] as number).toBeGreaterThan(0);
    }
  });

  it("multi-batch: same ItemCode emits ONE product + N batches", () => {
    const csv = [
      "﻿SrNo,ItemCode,ItemName,Pack,Manufacturer,HSN,GST%,MRP,PurchaseRate,SellingRate,ScheduleClass,BatchNo,ExpDate,Qty,Loc,Notes",
      "1,VPH-1,Crocin 500mg,Tab,Cipla,30049099,12,45.00,30.00,42.00,,B1,31/12/2027,100,R1,",
      "2,VPH-1,Crocin 500mg,Tab,Cipla,30049099,12,45.00,30.00,42.00,,B2,30/06/2028,200,R1,",
      "3,VPH-1,Crocin 500mg,Tab,Cipla,30049099,12,45.00,30.00,42.00,,B3,01/01/2029,150,R1,",
    ].join("\r\n");
    const r = adaptMargItemMasterCsvHardened(csv);
    const products = r.source.rows.filter((x) => x.kind === "product");
    const batches = r.source.rows.filter((x) => x.kind === "batch");
    expect(products.length).toBe(1);
    expect(batches.length).toBe(3);
    expect(batches.map((b) => b.fields["batchNo"])).toEqual(["B1", "B2", "B3"]);
  });

  it("duplicate batch (same ItemCode + same BatchNo) → warning, not duplicate", () => {
    const csv = [
      "SrNo,ItemCode,ItemName,Pack,Manufacturer,HSN,GST%,MRP,PurchaseRate,SellingRate,ScheduleClass,BatchNo,ExpDate,Qty,Loc,Notes",
      "1,VPH-1,Crocin,Tab,Cipla,30049099,12,45,30,42,,B1,31/12/2027,100,R1,",
      "2,VPH-1,Crocin,Tab,Cipla,30049099,12,45,30,42,,B1,31/12/2027,50,R1,",
    ].join("\n");
    const r = adaptMargItemMasterCsvHardened(csv);
    const batches = r.source.rows.filter((x) => x.kind === "batch");
    expect(batches.length).toBe(1);
    expect(r.source.warnings.some((w) => /duplicate batch/.test(w))).toBe(true);
  });

  it("expired batch flagged is_expired=1 (does not skip)", () => {
    const csv = [
      "SrNo,ItemCode,ItemName,Pack,Manufacturer,HSN,GST%,MRP,PurchaseRate,SellingRate,ScheduleClass,BatchNo,ExpDate,Qty,Loc,Notes",
      "1,VPH-1,Crocin,Tab,Cipla,30049099,12,45,30,42,,B1,31/12/2024,100,R1,",
      "2,VPH-1,Crocin,Tab,Cipla,30049099,12,45,30,42,,B2,31/12/2027,100,R1,",
    ].join("\n");
    const r = adaptMargItemMasterCsvHardened(csv, new Date("2026-05-08T00:00:00Z"));
    const batches = r.source.rows.filter((x) => x.kind === "batch");
    expect(batches.length).toBe(2);
    const b1 = batches.find((b) => b.fields["batchNo"] === "B1");
    const b2 = batches.find((b) => b.fields["batchNo"] === "B2");
    expect(b1?.fields["is_expired"]).toBe(1);
    expect(b2?.fields["is_expired"]).toBe(0);
  });

  it("invalid date row → reported in errors, processing continues", () => {
    const csv = [
      "SrNo,ItemCode,ItemName,Pack,Manufacturer,HSN,GST%,MRP,PurchaseRate,SellingRate,ScheduleClass,BatchNo,ExpDate,Qty,Loc,Notes",
      "1,VPH-1,Good,Tab,Cipla,30049099,12,45,30,42,,B1,31/12/2027,100,R1,",
      "2,VPH-2,Bad,Tab,Cipla,30049099,12,45,30,42,,B1,not-a-date,100,R1,",
      "3,VPH-3,Also Good,Tab,Cipla,30049099,12,45,30,42,,B1,01/01/2028,100,R1,",
    ].join("\n");
    const r = adaptMargItemMasterCsvHardened(csv);
    const products = r.source.rows.filter((x) => x.kind === "product");
    expect(products.length).toBe(2);                   // good rows imported
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]?.row).toBe(3);                  // 1-based file row
    expect(r.errors[0]?.msg).toMatch(/not-a-date/);
  });

  it("HSN whitespace/padding works on a real synthetic row", () => {
    const csv = [
      "SrNo,ItemCode,ItemName,Pack,Manufacturer,HSN,GST%,MRP,PurchaseRate,SellingRate,ScheduleClass,BatchNo,ExpDate,Qty,Loc,Notes",
      '1,VPH-1,X,Tab,Cipla,"  30049099  ",12,45,30,42,,B1,31/12/2027,100,R1,',
      "2,VPH-2,Y,Tab,Cipla,3004,12,45,30,42,,B1,31/12/2027,100,R1,",
    ].join("\n");
    const r = adaptMargItemMasterCsvHardened(csv);
    const products = r.source.rows.filter((x) => x.kind === "product");
    expect(products[0]?.fields["hsn"]).toBe("30049099");
    expect(products[1]?.fields["hsn"]).toBe("30040000");
  });
});

describe("parseCsv — BOM tolerance", () => {
  it("strips UTF-8 BOM at file start", () => {
    const rows = parseCsv("﻿a,b\n1,2\n");
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["1", "2"]);
  });
  it("CRLF + BOM together", () => {
    const rows = parseCsv("﻿a,b\r\n1,2\r\n");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("renderErrorReport", () => {
  it("emits import_errors.csv shape", () => {
    const out = renderErrorReport([
      { row: 5, msg: "bad date" },
      { row: 8, msg: 'has "quote" and , comma' },
    ]);
    expect(out).toMatch(/^row,error\n/);
    expect(out).toMatch(/5,bad date/);
    expect(out).toMatch(/8,"has ""quote"" and , comma"/);
  });
});
