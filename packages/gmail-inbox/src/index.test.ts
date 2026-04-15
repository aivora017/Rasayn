import { describe, it, expect } from "vitest";
import { parseHeaderHeuristic, applySupplierTemplate } from "./index.js";

describe("parseHeaderHeuristic", () => {
  it("extracts invoice no, date, supplier, total from realistic text", () => {
    const sample = [
      "GlaxoSmithKline Pharma Ltd",
      "Invoice No: GSK/APR/0042",
      "Date: 12/04/2026",
      "Crocin 500 Tab    100  24.00  2400.00",
      "Grand Total: 2688.00",
    ].join("\n");
    const h = parseHeaderHeuristic(sample);
    expect(h.invoiceNo).toBe("GSK/APR/0042");
    expect(h.invoiceDate).toBe("2026-04-12");
    expect(h.supplierHint).toMatch(/GlaxoSmithKline/);
    expect(h.totalPaise).toBe(268800);
    expect(h.confidence).toBeGreaterThan(0.9);
  });

  it("returns nulls + low confidence on garbage input", () => {
    const h = parseHeaderHeuristic("random noise without structure");
    expect(h.invoiceNo).toBeNull();
    expect(h.confidence).toBeLessThan(0.3);
  });
});


describe("applySupplierTemplate", () => {
  const gskTemplate: import("./index.js").SupplierTemplate = {
    id: "tpl_gsk",
    supplierId: "sup_gsk",
    name: "GSK Invoice v1",
    headerPatterns: {
      invoiceNo: "Invoice\\s*No[.:]\\s*([A-Z0-9/\\-]+)",
      invoiceDate: "Date[.:]\\s*(\\d{2}/\\d{2}/\\d{4})",
      total: "Grand\\s*Total[.:]\\s*([\\d,.]+)",
      supplier: "^(GlaxoSmithKline[^\\n]*)",
    },
    linePatterns: {
      row: "^(\\S[^|]+?)\\s+(\\d{8})\\s+(\\S+)\\s+(\\d{2}/\\d{4})\\s+(\\d{2}/\\d{4})\\s+(\\d+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+(\\d+)$",
    },
    columnMap: {
      product: 0, hsn: 1, batchNo: 2, mfgDate: 3, expiryDate: 4,
      qty: 5, ratePaise: 6, mrpPaise: 7, gstRate: 8,
    },
    dateFormat: "DD/MM/YYYY",
  };

  it("parses a well-formed invoice with multiple lines", () => {
    const text = [
      "GlaxoSmithKline Pharma Ltd",
      "Invoice No: GSK/APR/0042",
      "Date: 12/04/2026",
      "Crocin 500 Tab    30049099 CRN26A 04/2026 03/2028 100 24.00 36.00 12",
      "Dolo 650 Tab      30049099 DOL26A 04/2026 03/2028 50 23.00 34.95 12",
      "Grand Total: 2688.00",
    ].join("\n");
    const parsed = applySupplierTemplate(gskTemplate, text);
    expect(parsed.tier).toBe("A");
    expect(parsed.header.invoiceNo).toBe("GSK/APR/0042");
    // DD/MM/YYYY 12/04/2026 -> 2026-04-12
    expect(parsed.header.invoiceDate).toBe("2026-04-12");
    expect(parsed.header.totalPaise).toBe(268800);
    expect(parsed.header.supplierHint).toMatch(/GlaxoSmithKline/);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]?.productHint).toMatch(/Crocin/);
    expect(parsed.lines[0]?.qty).toBe(100);
    expect(parsed.lines[0]?.ratePaise).toBe(2400);
    expect(parsed.lines[0]?.mrpPaise).toBe(3600);
    expect(parsed.lines[0]?.gstRate).toBe(12);
    // 04/2026 with DD/MM/YYYY fmt won't parse (MM/YYYY only); that's fine -> null.
    expect(parsed.lines[0]?.confidence).toBeGreaterThan(0.3);
  });

  it("empty lines when row regex does not match", () => {
    const bad = applySupplierTemplate(gskTemplate, "totally unrelated text");
    expect(bad.lines).toEqual([]);
    expect(bad.header.confidence).toBe(0);
  });

  it("invalid regex is fail-safe", () => {
    const broken = { ...gskTemplate, linePatterns: { row: "(unclosed[" } };
    const out = applySupplierTemplate(broken, "anything");
    expect(out.lines).toEqual([]);
  });
});
