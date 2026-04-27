// Negative + edge-case tests for applySupplierTemplate.
// Coverage-gaps 2026-04-18 §Medium — index.test.ts had 5 happy-path cases;
// this file adds the rejection / partial-match / robustness paths.
import { describe, expect, it } from "vitest";
import { applySupplierTemplate, type SupplierTemplate } from "./index.js";

function tpl(overrides: Partial<SupplierTemplate> = {}): SupplierTemplate {
  return {
    id: "tpl_test",
    supplierId: "sup_test",
    name: "test",
    headerPatterns: {
      invoiceNo: "Invoice\\s*No[.:]\\s*([A-Z0-9/\\-]+)",
      invoiceDate: "Date[.:]\\s*(\\d{2}/\\d{2}/\\d{4})",
      total: "Total[.:]\\s*([\\d.,]+)",
    },
    linePatterns: {
      row: "^(\\S+)\\s+(\\d+)\\s+([\\d.]+)\\s+([\\d.]+)$",
    },
    columnMap: { product: 0, qty: 1, ratePaise: 2, mrpPaise: 3 },
    dateFormat: "DD/MM/YYYY",
    ...overrides,
  };
}

describe("applySupplierTemplate — invalid regex", () => {
  it("returns empty lines + 0 confidence when row regex is malformed", () => {
    const t = tpl({ linePatterns: { row: "([" } }); // unbalanced bracket
    const r = applySupplierTemplate(t, "Crocin 100 24.00 2400");
    expect(r.lines).toEqual([]);
    expect(r.header.confidence).toBe(0);
  });
});

describe("applySupplierTemplate — header partial match", () => {
  it("invoice no found, no date, no total → low confidence", () => {
    const r = applySupplierTemplate(tpl(), "Invoice No: GSK/0001\nrandom text");
    expect(r.header.invoiceNo).toBe("GSK/0001");
    expect(r.header.invoiceDate).toBeNull();
    expect(r.header.totalPaise).toBeNull();
    expect(r.header.confidence).toBeLessThan(0.5);
  });

  it("all four header fields present → confidence ≥0.9", () => {
    const sample = [
      "GSK Pharma",
      "Invoice No: GSK/0001",
      "Date: 12/04/2026",
      "Crocin 100 24.00 2400.00",
      "Total: 2400.00",
    ].join("\n");
    const r = applySupplierTemplate(
      tpl({ headerPatterns: { ...tpl().headerPatterns, supplier: "^(GSK[^\\n]*)" } }),
      sample,
    );
    expect(r.header.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.header.totalPaise).toBe(240000);
  });
});

describe("applySupplierTemplate — line robustness", () => {
  it("skips rows where the product capture is empty", () => {
    const sample = [
      "Invoice No: G/1\nDate: 01/04/2026\nTotal: 100.00",
      "Crocin 5 10.00 50.00", // valid
      "       2 5.00 10.00",  // empty product → skipped
    ].join("\n");
    const r = applySupplierTemplate(tpl(), sample);
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]?.productHint).toBe("Crocin");
  });

  it("missing qty / rate / mrp produces lower per-line confidence", () => {
    const sample = "Invoice No: G/1\nDate: 01/04/2026\nCrocin 1 0 0";
    const r = applySupplierTemplate(tpl(), sample);
    expect(r.lines[0]?.confidence).toBeLessThanOrEqual(0.6);
  });

  it("expired date in DD/MM/YYYY parses to ISO YYYY-MM-DD", () => {
    const t = tpl({
      linePatterns: { row: "^(\\S+)\\s+(\\d+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+(\\d{2}/\\d{2}/\\d{4})$" },
      columnMap: { product: 0, qty: 1, ratePaise: 2, mrpPaise: 3, expiryDate: 4 },
    });
    const sample = "Invoice No: G/1\nDate: 01/04/2026\nCrocin 5 10 50 31/12/2027";
    const r = applySupplierTemplate(t, sample);
    expect(r.lines[0]?.expiryDate).toBe("2027-12-31");
  });

  it("named capture groups via columnMap string keys also work", () => {
    const t = tpl({
      linePatterns: {
        row: "^(?<product>\\S+)\\s+(?<qty>\\d+)\\s+(?<rate>[\\d.]+)\\s+(?<mrp>[\\d.]+)$",
      },
      columnMap: { product: "product", qty: "qty", ratePaise: "rate", mrpPaise: "mrp" },
    });
    const r = applySupplierTemplate(t, "Crocin 10 24.00 2400.00");
    expect(r.lines[0]?.productHint).toBe("Crocin");
    expect(r.lines[0]?.qty).toBe(10);
    expect(r.lines[0]?.mrpPaise).toBe(240000);
  });

  it("no rows matched → empty lines, header still parsed", () => {
    const r = applySupplierTemplate(tpl(), "Invoice No: G/1\nDate: 01/04/2026");
    expect(r.lines).toEqual([]);
    expect(r.header.invoiceNo).toBe("G/1");
  });

  it("HSN column populated when columnMap.hsn is set", () => {
    const t = tpl({
      linePatterns: {
        row: "^(\\S+)\\s+(\\d+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+(\\d{6,8})$",
      },
      columnMap: { product: 0, qty: 1, ratePaise: 2, mrpPaise: 3, hsn: 4 },
    });
    const r = applySupplierTemplate(t, "Crocin 5 10.00 50.00 30049099");
    expect(r.lines[0]?.hsn).toBe("30049099");
  });
});

describe("applySupplierTemplate — tier marker", () => {
  it("always returns tier 'A' (this is the regex-template parser, not LLM)", () => {
    const r = applySupplierTemplate(tpl(), "Invoice No: G/1");
    expect(r.tier).toBe("A");
  });
});
