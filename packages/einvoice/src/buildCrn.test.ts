/**
 * A8 / ADR 0021 step 6 — CRN-IRN payload builder tests.
 *
 * Asserts the GSTN NIC v1.1 credit-note schema:
 *   - DocDtls.Typ = "CRN"
 *   - RefDtls.PrecDocDtls = [{ InvNo, InvDt }] referencing original invoice
 *   - ValDtls / ItemList carry refund amounts as positive rupee values
 *   - Validation: original invoice ref required, refund total positive
 *   - Forward-path validation reused (GSTIN shape, totals match, etc.)
 */

import { describe, expect, it } from "vitest";
import {
  buildCrnPayload,
  serialiseCrnPayload,
  validateCreditNoteForIrn,
  type BuildCrnInput,
} from "./index.js";
import type {
  CreditNoteForIrn,
  CreditNoteLineForIrn,
  PartyForIrn,
  ShopForIrn,
} from "./types.js";

const SHOP: ShopForIrn = {
  annualTurnoverPaise: 6_00_00_00_000, // ₹6Cr — over the 5Cr threshold
  einvoiceEnabled: true,
  einvoiceVendor: "cygnet",
};

const SELLER: PartyForIrn = {
  gstin: "27ABCDE1234F1Z5",
  legalName: "Vaidyanath Pharmacy",
  address1: "1st Floor, Main Rd",
  location: "Kalyan",
  pincode: 421301,
  stateCode: "27",
};

const BUYER: PartyForIrn = {
  gstin: "27AAAAA0000A1Z5",
  legalName: "Apollo Pharmacy LLC",
  address1: "Plot 12 Bandra-Kurla",
  location: "Mumbai",
  pincode: 400051,
  stateCode: "27",
};

function makeLine(
  overrides: Partial<CreditNoteLineForIrn> = {},
): CreditNoteLineForIrn {
  // Pro-rata of 1 strip (qty=1) from a 10-strip line, taxable 10000, 12% GST.
  return {
    slNo: 1,
    productName: "Crocin 500 Tab",
    hsn: "30049099",
    qtyReturned: 1,
    unit: "NOS",
    mrpPaise: 220,
    refundDiscountPaise: 0,
    refundTaxablePaise: 1000,
    gstRate: 12,
    refundCgstPaise: 60,
    refundSgstPaise: 60,
    refundIgstPaise: 0,
    refundLineTotalPaise: 1120,
    ...overrides,
  };
}

function makeCn(overrides: Partial<CreditNoteForIrn> = {}): CreditNoteForIrn {
  const lines = overrides.lines ?? [makeLine()];
  const subtotal = lines.reduce((s, l) => s + l.refundTaxablePaise, 0);
  const cgst = lines.reduce((s, l) => s + l.refundCgstPaise, 0);
  const sgst = lines.reduce((s, l) => s + l.refundSgstPaise, 0);
  const igst = lines.reduce((s, l) => s + l.refundIgstPaise, 0);
  const total = lines.reduce((s, l) => s + l.refundLineTotalPaise, 0);
  return {
    returnId: "ret_1",
    returnNo: "CN/2025-26/0001",
    createdAtIso: "2026-04-17T14:30:00.000Z",
    gstTreatment: "intra_state",
    originalBillNo: "B-00021",
    originalBilledAtIso: "2026-04-15T14:03:00.000Z",
    refundSubtotalPaise: subtotal,
    refundCgstPaise: cgst,
    refundSgstPaise: sgst,
    refundIgstPaise: igst,
    refundRoundOffPaise: 0,
    refundTotalPaise: total,
    lines,
    seller: SELLER,
    buyer: BUYER,
    ...overrides,
  };
}

function input(overrides: Partial<CreditNoteForIrn> = {}): BuildCrnInput {
  return { shop: SHOP, creditNote: makeCn(overrides) };
}

describe("buildCrnPayload — happy path", () => {
  it("builds a valid CRN payload with Typ=CRN and PrecDocDtls", () => {
    const r = buildCrnPayload(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.DocDtls.Typ).toBe("CRN");
    expect(r.payload.DocDtls.No).toBe("CN/2025-26/0001");
    expect(r.payload.RefDtls?.PrecDocDtls?.[0]).toEqual({
      InvNo: "B-00021",
      InvDt: "15/04/2026",
    });
  });

  it("ItemList carries refund amounts as positive rupee values", () => {
    const r = buildCrnPayload(input());
    if (!r.ok) throw new Error("expected ok");
    const it = r.payload.ItemList[0]!;
    expect(it.AssAmt).toBe(10);    // 1000 paise → ₹10.00
    expect(it.CgstAmt).toBe(0.6);  // 60 paise → ₹0.60
    expect(it.SgstAmt).toBe(0.6);
    expect(it.IgstAmt).toBe(0);
    expect(it.TotItemVal).toBe(11.2);
    expect(it.GstRt).toBe(12);
    expect(it.HsnCd).toBe("30049099");
  });

  it("ValDtls aggregates refund subtotals correctly", () => {
    const r = buildCrnPayload(
      input({
        lines: [
          makeLine({ refundTaxablePaise: 1000, refundCgstPaise: 60, refundSgstPaise: 60, refundLineTotalPaise: 1120 }),
          makeLine({ slNo: 2, productName: "Dolo 650", refundTaxablePaise: 500, refundCgstPaise: 45, refundSgstPaise: 45, refundLineTotalPaise: 590 }),
        ],
      }),
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.ValDtls.AssVal).toBe(15);
    expect(r.payload.ValDtls.CgstVal).toBe(1.05);
    expect(r.payload.ValDtls.SgstVal).toBe(1.05);
    expect(r.payload.ValDtls.TotInvVal).toBe(17.1);
  });

  it("serialiseCrnPayload returns a stable JSON string", () => {
    const r = buildCrnPayload(input());
    if (!r.ok) throw new Error("expected ok");
    const s = serialiseCrnPayload(r.payload);
    expect(s).toMatch(/"Typ":"CRN"/);
    expect(s).toMatch(/"PrecDocDtls"/);
    // Stable: same input → same output
    expect(serialiseCrnPayload(r.payload)).toBe(s);
  });
});

describe("validateCreditNoteForIrn — rejection paths", () => {
  it("rejects empty original invoice number", () => {
    const v = validateCreditNoteForIrn(input({ originalBillNo: "" }));
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain("ORIG_INVOICE_NO_EMPTY");
  });

  it("rejects empty original invoice date", () => {
    const v = validateCreditNoteForIrn(input({ originalBilledAtIso: "" }));
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain("ORIG_INVOICE_DATE_EMPTY");
  });

  it("rejects non-positive refundTotalPaise", () => {
    const v = validateCreditNoteForIrn(input({ refundTotalPaise: 0 }));
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain("REFUND_AMOUNT_NON_POSITIVE");
  });

  it("rejects empty lines", () => {
    const v = validateCreditNoteForIrn(input({ lines: [], refundTotalPaise: 100 }));
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain("EMPTY_LINES");
  });

  it("inherits forward-path validation: bad seller GSTIN", () => {
    const v = validateCreditNoteForIrn({
      shop: SHOP,
      creditNote: makeCn({
        seller: { ...SELLER, gstin: "BAD" },
      }),
    });
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain("SELLER_GSTIN_INVALID");
  });

  it("inherits forward-path validation: intra-state with IGST is rejected", () => {
    const v = validateCreditNoteForIrn(
      input({
        gstTreatment: "intra_state",
        lines: [
          makeLine({
            refundTaxablePaise: 1000,
            refundCgstPaise: 0,
            refundSgstPaise: 0,
            refundIgstPaise: 120,
            refundLineTotalPaise: 1120,
          }),
        ],
        refundCgstPaise: 0,
        refundSgstPaise: 0,
        refundIgstPaise: 120,
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain("INTRA_HAS_IGST");
  });

  it("happy: returns ok=true on a valid intra-state credit note", () => {
    const v = validateCreditNoteForIrn(input());
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });
});

describe("buildCrnPayload — error path returns ok=false with codes", () => {
  it("returns ok=false + errors when original invoice missing", () => {
    const r = buildCrnPayload(input({ originalBillNo: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toContain("ORIG_INVOICE_NO_EMPTY");
  });
});

describe("buildCrnPayload — Cygnet vendor parity", () => {
  it("builds the same payload regardless of einvoiceVendor (cygnet vs cleartax fallback)", () => {
    const cygnet = buildCrnPayload({
      shop: { ...SHOP, einvoiceVendor: "cygnet" },
      creditNote: makeCn(),
    });
    const cleartax = buildCrnPayload({
      shop: { ...SHOP, einvoiceVendor: "cleartax" },
      creditNote: makeCn(),
    });
    if (!cygnet.ok || !cleartax.ok) throw new Error("expected ok");
    // Vendor selection happens at the wire-level adapter in Rust;
    // payload shape must be identical.
    expect(serialiseCrnPayload(cygnet.payload)).toBe(
      serialiseCrnPayload(cleartax.payload),
    );
  });
});
