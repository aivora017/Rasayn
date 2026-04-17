import { describe, it, expect } from "vitest";
import { buildIrnPayload, serialiseIrnPayload } from "./build.js";
import type { BillForIrn, ShopForIrn } from "./types.js";

const shopOk: ShopForIrn = {
  annualTurnoverPaise: 6_00_00_000_00,
  einvoiceEnabled: true,
  einvoiceVendor: "cygnet",
};

function makeBill(): BillForIrn {
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
      address1: "Shop 1",
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
  };
}

describe("buildIrnPayload", () => {
  it("returns ok + payload for a clean bill", () => {
    const r = buildIrnPayload({ shop: shopOk, bill: makeBill() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.Version).toBe("1.1");
    expect(r.payload.TranDtls.SupTyp).toBe("B2B");
    expect(r.payload.DocDtls.Typ).toBe("INV");
    expect(r.payload.DocDtls.No).toBe("INV-001");
    expect(r.payload.DocDtls.Dt).toBe("17/04/2026");
  });

  it("returns err on invalid bill", () => {
    const b = makeBill();
    b.buyer.gstin = "";
    const r = buildIrnPayload({ shop: shopOk, bill: b });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "NOT_B2B")).toBe(true);
  });

  it("converts paise → rupees in ValDtls", () => {
    const r = buildIrnPayload({ shop: shopOk, bill: makeBill() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.ValDtls.AssVal).toBe(100);
    expect(r.payload.ValDtls.CgstVal).toBe(9);
    expect(r.payload.ValDtls.SgstVal).toBe(9);
    expect(r.payload.ValDtls.IgstVal).toBe(0);
    expect(r.payload.ValDtls.TotInvVal).toBe(118);
  });

  it("maps each line into an ItemList entry with UQC default NOS", () => {
    const r = buildIrnPayload({ shop: shopOk, bill: makeBill() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.ItemList).toHaveLength(1);
    const item = r.payload.ItemList[0]!;
    expect(item.Unit).toBe("NOS");
    expect(item.HsnCd).toBe("300490");
    expect(item.Qty).toBe(2);
    expect(item.IsServc).toBe("N");
    expect(item.GstRt).toBe(18);
    expect(item.CgstAmt).toBe(9);
    expect(item.SgstAmt).toBe(9);
    expect(item.IgstAmt).toBe(0);
  });

  it("respects custom unit if set", () => {
    const b = makeBill();
    b.lines[0]!.unit = "STR";
    const r = buildIrnPayload({ shop: shopOk, bill: b });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.ItemList[0]!.Unit).toBe("STR");
  });

  it("preserves seller + buyer fields verbatim", () => {
    const r = buildIrnPayload({ shop: shopOk, bill: makeBill() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.SellerDtls.Gstin).toBe("27AAAPL1234C1ZV");
    expect(r.payload.SellerDtls.Pin).toBe(400001);
    expect(r.payload.SellerDtls.Stcd).toBe("27");
    expect(r.payload.BuyerDtls.Gstin).toBe("27BBBBB2222D2ZV");
    expect(r.payload.BuyerDtls.Pin).toBe(411001);
  });

  it("handles round-off", () => {
    const b = makeBill();
    b.roundOffPaise = 50;
    b.grandTotalPaise = 11850; // lines(11800) + round(50)
    const r = buildIrnPayload({ shop: shopOk, bill: b });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.ValDtls.RndOffAmt).toBe(0.5);
    expect(r.payload.ValDtls.TotInvVal).toBe(118.5);
  });

  it("handles negative round-off", () => {
    const b = makeBill();
    b.roundOffPaise = -25;
    b.grandTotalPaise = 11775;
    const r = buildIrnPayload({ shop: shopOk, bill: b });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.ValDtls.RndOffAmt).toBe(-0.25);
  });

  it("serialiseIrnPayload returns parseable JSON", () => {
    const r = buildIrnPayload({ shop: shopOk, bill: makeBill() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = serialiseIrnPayload(r.payload);
    const parsed = JSON.parse(s) as unknown;
    expect(parsed).toEqual(r.payload);
  });

  it("handles 3-line bill with varied HSN / GST rates", () => {
    const b = makeBill();
    b.lines = [
      {
        slNo: 1,
        productName: "A",
        hsn: "300490",
        qty: 1,
        mrpPaise: 10000,
        discountPaise: 0,
        taxableValuePaise: 10000,
        gstRate: 12,
        cgstPaise: 600,
        sgstPaise: 600,
        igstPaise: 0,
        lineTotalPaise: 11200,
      },
      {
        slNo: 2,
        productName: "B",
        hsn: "30041090",
        qty: 3,
        mrpPaise: 2000,
        discountPaise: 200,
        taxableValuePaise: 5800,
        gstRate: 18,
        cgstPaise: 522,
        sgstPaise: 522,
        igstPaise: 0,
        lineTotalPaise: 6844,
      },
      {
        slNo: 3,
        productName: "C",
        hsn: "300450",
        qty: 1,
        mrpPaise: 400,
        discountPaise: 0,
        taxableValuePaise: 400,
        gstRate: 5,
        cgstPaise: 10,
        sgstPaise: 10,
        igstPaise: 0,
        lineTotalPaise: 420,
      },
    ];
    b.subtotalPaise = 10000 + 5800 + 400;
    b.cgstPaise = 600 + 522 + 10;
    b.sgstPaise = 600 + 522 + 10;
    b.grandTotalPaise = 11200 + 6844 + 420;

    const r = buildIrnPayload({ shop: shopOk, bill: b });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.ItemList).toHaveLength(3);
    expect(r.payload.ItemList[1]!.GstRt).toBe(18);
    expect(r.payload.ItemList[1]!.Discount).toBe(2);
  });
});
