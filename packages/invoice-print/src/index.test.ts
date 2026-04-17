import { describe, expect, it } from "vitest";
import { isB2B, renderInvoice, renderInvoiceHtml, resolveLayout } from "./index.js";
import { makeBill } from "./fixtures.js";
import type { PrintReceipt } from "./types.js";

describe("resolveLayout", () => {
  it("defaults to shop default when no override and no customer", () => {
    const bill = makeBill();
    expect(resolveLayout(bill)).toBe("thermal_80mm");
  });
  it("forces a5_gst when customer has GSTIN (B2B)", () => {
    const bill = makeBill({
      customer: {
        id: "c_1", name: "Acme Hospital", phone: null,
        gstin: "27AAACA1234A1Z5", address: "Mumbai",
      },
    });
    expect(isB2B(bill.customer)).toBe(true);
    expect(resolveLayout(bill)).toBe("a5_gst");
  });
  it("honours override even for B2C", () => {
    const bill = makeBill();
    expect(resolveLayout(bill, "a5_gst")).toBe("a5_gst");
  });
  it("respects shop.defaultInvoiceLayout for non-B2B", () => {
    const bill = makeBill({
      shop: { ...makeBill().shop, defaultInvoiceLayout: "a5_gst" },
    });
    expect(resolveLayout(bill)).toBe("a5_gst");
  });
});

describe("renderInvoiceHtml — thermal 80mm", () => {
  const html = renderInvoice(makeBill());

  it("is a complete HTML document with @page 80mm", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("size: 80mm auto");
    expect(html).toContain("</html>");
  });
  it("includes shop name, bill no, and grand total", () => {
    expect(html).toContain("Vaidyanath Pharmacy");
    expect(html).toContain("B-00021");
    expect(html).toContain("₹ 400.25");
  });
  it("renders amount in words", () => {
    expect(html).toContain("Rupees Four Hundred and Twenty-Five Paise Only");
  });
  it("tags schedule H lines", () => {
    expect(html).toContain("[H]");
  });
  it("lists payments in thermal footer", () => {
    expect(html).toContain("CASH");
  });
  it("injects auto-print bootstrap", () => {
    expect(html).toContain("window.print()");
  });
});

describe("renderInvoiceHtml — A5 GST (B2B)", () => {
  const bill = makeBill({
    customer: {
      id: "c_1", name: "Acme Hospital", phone: "022-22221111",
      gstin: "27AAACA1234A1Z5", address: "Fort, Mumbai 400001",
    },
  });
  const html = renderInvoice(bill);

  it("picks A5 layout automatically", () => {
    expect(html).toContain("size: A5 portrait");
  });
  it("prints TAX INVOICE banner and GSTIN", () => {
    expect(html).toContain("TAX INVOICE");
    expect(html).toContain("27AAACA1234A1Z5");
  });
  it("shows HSN-wise tax summary table", () => {
    expect(html).toContain("HSN-wise tax summary");
    expect(html).toContain("3004");
  });
  it("includes billed-to party block", () => {
    expect(html).toContain("Acme Hospital");
    expect(html).toContain("022-22221111");
  });
  it("derives Maharashtra from state code 27 for jurisdiction", () => {
    expect(html).toContain("Maharashtra");
  });
});

describe("DUPLICATE stamp", () => {
  const receipt: PrintReceipt = {
    id: "pa_1", billId: "bill_1", layout: "thermal_80mm",
    isDuplicate: 1, printCount: 2, stampedAt: "2026-04-17T14:05:00.000Z",
  };
  it("shows DUPLICATE — REPRINT banner on reprints", () => {
    const html = renderInvoice(makeBill(), { printReceipt: receipt });
    expect(html).toContain("DUPLICATE — REPRINT");
    expect(html).toContain("#2");
  });
  it("omits banner on first print (isDuplicate=0)", () => {
    const html = renderInvoice(makeBill(), {
      printReceipt: { ...receipt, isDuplicate: 0, printCount: 1 },
    });
    expect(html).not.toContain("DUPLICATE — REPRINT");
  });
});

describe("security — HTML escaping", () => {
  it("escapes shop name and customer name", () => {
    const bill = makeBill({
      shop: { ...makeBill().shop, name: "<script>alert(1)</script>" },
      customer: {
        id: "c_x", name: `Evil "Tom" & <Jerry>`, phone: null, gstin: null, address: null,
      },
    });
    const html = renderInvoiceHtml({ bill });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;Jerry&gt;");
  });
});

describe("edge — zero lines / no payments", () => {
  it("renders skeleton even with empty lines + payments", () => {
    const bill = makeBill({ lines: [], payments: [], hsnTaxSummary: [] });
    const html = renderInvoiceHtml({ bill });
    expect(html).toContain("Vaidyanath Pharmacy");
  });
});
