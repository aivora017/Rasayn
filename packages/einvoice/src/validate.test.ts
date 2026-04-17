import { describe, it, expect } from "vitest";
import { validateBillForIrn } from "./validate.js";
import type { BillForIrn, ShopForIrn } from "./types.js";

const shopOk: ShopForIrn = {
  annualTurnoverPaise: 6_00_00_000_00, // ₹6Cr
  einvoiceEnabled: true,
  einvoiceVendor: "cygnet",
};

function makeBill(overrides: Partial<BillForIrn> = {}): BillForIrn {
  return {
    billId: "b1",
    billNo: "INV-001",
    billedAtIso: "2026-04-17T10:00:00Z",
    gstTreatment: "intra_state",
    subtotalPaise: 10000,
    cgstPaise: 900,
    sgstPaise: 900,
    igstPaise: 0,
    roundOffPaise: 0,
    grandTotalPaise: 11800,
    seller: {
      gstin: "27AAAPL1234C1ZV",
      legalName: "Rasayn Pharma",
      address1: "Shop 1, Main Rd",
      location: "Mumbai",
      pincode: 400001,
      stateCode: "27",
    },
    buyer: {
      gstin: "27BBBBB2222D2ZV",
      legalName: "Buyer Corp",
      address1: "Suite 2",
      location: "Pune",
      pincode: 411001,
      stateCode: "27",
    },
    lines: [
      {
        slNo: 1,
        productName: "Paracetamol 500mg",
        hsn: "300490",
        qty: 2,
        mrpPaise: 5000,
        discountPaise: 0,
        taxableValuePaise: 10000,
        gstRate: 18,
        cgstPaise: 900,
        sgstPaise: 900,
        igstPaise: 0,
        lineTotalPaise: 11800,
      },
    ],
    ...overrides,
  };
}

describe("validateBillForIrn", () => {
  it("passes a clean intra_state B2B bill", () => {
    const r = validateBillForIrn({ shop: shopOk, bill: makeBill() });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("flags disabled shop", () => {
    const r = validateBillForIrn({
      shop: { ...shopOk, einvoiceEnabled: false },
      bill: makeBill(),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "EINVOICE_DISABLED")).toBe(true);
  });

  it("flags turnover at exactly threshold (must be strictly above)", () => {
    const r = validateBillForIrn({
      shop: { ...shopOk, annualTurnoverPaise: 5_00_00_000_00 },
      bill: makeBill(),
    });
    expect(r.errors.some((e) => e.code === "TURNOVER_BELOW_THRESHOLD")).toBe(true);
  });

  it("accepts turnover 1 paise above threshold", () => {
    const r = validateBillForIrn({
      shop: { ...shopOk, annualTurnoverPaise: 5_00_00_000_01 },
      bill: makeBill(),
    });
    expect(r.ok).toBe(true);
  });

  it("flags missing buyer GSTIN as NOT_B2B", () => {
    const b = makeBill();
    b.buyer.gstin = "";
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "NOT_B2B")).toBe(true);
  });

  it("flags malformed buyer GSTIN", () => {
    const b = makeBill();
    b.buyer.gstin = "NOTAGSTIN";
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "BUYER_GSTIN_INVALID")).toBe(true);
  });

  it("flags seller GSTIN", () => {
    const b = makeBill();
    b.seller.gstin = "BAD";
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "SELLER_GSTIN_INVALID")).toBe(true);
  });

  it("flags invoice no too long", () => {
    const r = validateBillForIrn({
      shop: shopOk,
      bill: makeBill({ billNo: "INV/2026/04/00015" }),
    });
    expect(
      r.errors.some((e) => e.code === "INVOICE_NO_TOO_LONG")
    ).toBe(true);
  });

  it("flags empty invoice no", () => {
    const r = validateBillForIrn({
      shop: shopOk,
      bill: makeBill({ billNo: "" }),
    });
    expect(r.errors.some((e) => e.code === "INVOICE_NO_EMPTY")).toBe(true);
  });

  it("flags empty lines", () => {
    const r = validateBillForIrn({
      shop: shopOk,
      bill: makeBill({ lines: [] }),
    });
    expect(r.errors.some((e) => e.code === "EMPTY_LINES")).toBe(true);
  });

  it("flags bad HSN", () => {
    const b = makeBill();
    b.lines[0]!.hsn = "ABC";
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "HSN_INVALID")).toBe(true);
  });

  it("flags intra_state bill with IGST on a line", () => {
    const b = makeBill();
    b.lines[0]!.igstPaise = 100;
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "INTRA_HAS_IGST")).toBe(true);
  });

  it("flags inter_state bill with CGST on a line", () => {
    const b = makeBill({
      gstTreatment: "inter_state",
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 1800,
      lines: [
        {
          slNo: 1,
          productName: "Paracetamol",
          hsn: "300490",
          qty: 2,
          mrpPaise: 5000,
          discountPaise: 0,
          taxableValuePaise: 10000,
          gstRate: 18,
          cgstPaise: 900,     // invalid here
          sgstPaise: 900,
          igstPaise: 0,
          lineTotalPaise: 11800,
        },
      ],
    });
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "INTER_HAS_CGST")).toBe(true);
  });

  it("flags totals mismatch", () => {
    const b = makeBill({ grandTotalPaise: 99999 });
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "TOTALS_MISMATCH")).toBe(true);
  });

  it("flags bad PIN", () => {
    const b = makeBill();
    b.seller.pincode = 12;
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "PIN_INVALID")).toBe(true);
  });

  it("flags bad state code", () => {
    const b = makeBill();
    b.buyer.stateCode = "ABC";
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.some((e) => e.code === "STATECODE_INVALID")).toBe(true);
  });

  it("collects all errors, does not short-circuit", () => {
    const b = makeBill({ billNo: "", lines: [] });
    b.buyer.gstin = "";
    const r = validateBillForIrn({ shop: shopOk, bill: b });
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
