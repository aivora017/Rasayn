import { describe, it, expect } from "vitest";
import { buildGstr3b, reconcile2b, buildGstr9, type BillRow, type PurchaseRow, type Gstr2bPortalRow, type Gstr3b } from "./index.js";
import { paise } from "@pharmacare/shared-types";

const sale = (n: number, igst = 0, cgst = 0, sgst = 0, isRefund = false): BillRow => ({
  billId: `b${n}`, billNo: `B${n}`, billedAt: "2026-04-15", customerStateCode: "27",
  taxablePaise: paise(10000 * n),
  cgstPaise: paise(cgst), sgstPaise: paise(sgst), igstPaise: paise(igst), cessPaise: paise(0),
  isRefund,
});

const purchase = (n: number, igst = 0, eligible = true): PurchaseRow => ({
  grnId: `g${n}`, invoiceNo: `INV${n}`, invoiceDate: "2026-04-10",
  supplierGstin: "27ABCDE1234F1Z5",
  taxablePaise: paise(5000 * n),
  cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(igst), cessPaise: paise(0),
  itcEligible: eligible,
});

describe("buildGstr3b", () => {
  it("aggregates outward supplies", () => {
    const r = buildGstr3b({
      period: "2026-04", shopId: "s1",
      bills: [sale(1, 0, 250, 250), sale(2, 0, 500, 500)],
      purchases: [],
    });
    expect(r.outwardSupplies.taxablePaise).toBe(paise(30000));
    expect(r.outwardSupplies.cgstPaise).toBe(paise(750));
    expect(r.outwardSupplies.sgstPaise).toBe(paise(750));
  });

  it("subtracts refunds from sales", () => {
    const r = buildGstr3b({
      period: "2026-04", shopId: "s1",
      bills: [sale(2, 0, 500, 500), sale(1, 0, 250, 250, true)],   // sale 20000, refund 10000
      purchases: [],
    });
    expect(r.outwardSupplies.taxablePaise).toBe(paise(10000));
    expect(r.outwardSupplies.cgstPaise).toBe(paise(250));
  });

  it("computes eligible ITC", () => {
    const r = buildGstr3b({
      period: "2026-04", shopId: "s1",
      bills: [],
      purchases: [purchase(1, 250), purchase(2, 500), purchase(3, 750, false)],
    });
    expect(r.eligibleItc.igstPaise).toBe(paise(750));        // only first 2 eligible
    expect(r.eligibleItc.taxablePaise).toBe(paise(15000));
  });

  it("net tax payable subtracts ITC, never below zero", () => {
    const r = buildGstr3b({
      period: "2026-04", shopId: "s1",
      bills: [sale(2, 1000, 0, 0)],          // outward IGST 1000
      purchases: [purchase(2, 600)],         // ITC IGST 600
    });
    expect(r.taxPayable.igstPaise).toBe(paise(400));
  });

  it("net tax payable clamps at zero when ITC > outward", () => {
    const r = buildGstr3b({
      period: "2026-04", shopId: "s1",
      bills: [sale(1, 100, 0, 0)],
      purchases: [purchase(2, 500)],
    });
    expect(r.taxPayable.igstPaise).toBe(paise(0));
  });

  it("classifies zero-tax bills as nil-rated", () => {
    const r = buildGstr3b({
      period: "2026-04", shopId: "s1",
      bills: [sale(1, 0, 250, 250), sale(3)],         // second has 0 tax
      purchases: [],
    });
    expect(r.nilRatedTaxablePaise).toBe(paise(30000));
  });
});

describe("reconcile2b", () => {
  it("matches when amounts agree (within ₹1 tolerance)", () => {
    const ours = [purchase(1, 250)];
    const portal: Gstr2bPortalRow[] = [{
      supplierGstin: "27ABCDE1234F1Z5", invoiceNo: "INV1", invoiceDate: "2026-04-10",
      taxablePaise: paise(5000), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(250), cessPaise: paise(0),
    }];
    const r = reconcile2b(ours, portal);
    expect(r).toHaveLength(1);
    expect(r[0]?.status).toBe("match");
  });

  it("flags mismatch when delta > tolerance", () => {
    const ours = [purchase(1, 250)];                 // taxable 5000
    const portal: Gstr2bPortalRow[] = [{
      supplierGstin: "27ABCDE1234F1Z5", invoiceNo: "INV1", invoiceDate: "2026-04-10",
      taxablePaise: paise(5500), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(275), cessPaise: paise(0),
    }];
    const r = reconcile2b(ours, portal);
    expect(r[0]?.status).toBe("mismatch");
    expect(r[0]?.diffPaise).toBe(paise(-500));
  });

  it("flags missing-on-our-side when portal has invoice we don't", () => {
    const portal: Gstr2bPortalRow[] = [{
      supplierGstin: "27GGGG1234F1Z5", invoiceNo: "GHOST",
      invoiceDate: "2026-04-10",
      taxablePaise: paise(10000), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(500), cessPaise: paise(0),
    }];
    const r = reconcile2b([], portal);
    expect(r[0]?.status).toBe("missing-on-our-side");
  });

  it("flags missing-on-portal when we have GRN supplier hasn't filed", () => {
    const ours = [purchase(1, 250)];
    const r = reconcile2b(ours, []);
    expect(r[0]?.status).toBe("missing-on-portal");
  });

  it("handles a mix correctly", () => {
    const ours = [purchase(1, 250), purchase(2, 500)];
    const portal: Gstr2bPortalRow[] = [{
      supplierGstin: "27ABCDE1234F1Z5", invoiceNo: "INV1", invoiceDate: "2026-04-10",
      taxablePaise: paise(5000), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(250), cessPaise: paise(0),
    }, {
      supplierGstin: "27ZZZZ1234F1Z5", invoiceNo: "GHOST", invoiceDate: "2026-04-10",
      taxablePaise: paise(2000), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(100), cessPaise: paise(0),
    }];
    const r = reconcile2b(ours, portal);
    expect(r.find((x) => x.invoiceNo === "INV1")?.status).toBe("match");
    expect(r.find((x) => x.invoiceNo === "GHOST")?.status).toBe("missing-on-our-side");
    expect(r.find((x) => x.invoiceNo === "INV2")?.status).toBe("missing-on-portal");
  });
});

describe("buildGstr9", () => {
  it("aggregates 12 monthly outward sections", () => {
    const months: Gstr3b[] = [
      { period: "2026-04", shopId: "s1",
        outwardSupplies: { taxablePaise: paise(10000), cgstPaise: paise(250), sgstPaise: paise(250), igstPaise: paise(0), cessPaise: paise(0) },
        eligibleItc: { taxablePaise: paise(0), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(0), cessPaise: paise(0) },
        taxPayable: { taxablePaise: paise(0), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(0), cessPaise: paise(0) },
        zeroRatedTaxablePaise: paise(0), nilRatedTaxablePaise: paise(0),
      },
      { period: "2026-05", shopId: "s1",
        outwardSupplies: { taxablePaise: paise(20000), cgstPaise: paise(500), sgstPaise: paise(500), igstPaise: paise(0), cessPaise: paise(0) },
        eligibleItc: { taxablePaise: paise(0), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(0), cessPaise: paise(0) },
        taxPayable: { taxablePaise: paise(0), cgstPaise: paise(0), sgstPaise: paise(0), igstPaise: paise(0), cessPaise: paise(0) },
        zeroRatedTaxablePaise: paise(0), nilRatedTaxablePaise: paise(0),
      },
    ];
    const r = buildGstr9("2026-27", "s1", months);
    expect(r.annualTotals.taxablePaise).toBe(paise(30000));
    expect(r.annualTotals.cgstPaise).toBe(paise(750));
    expect(r.months).toHaveLength(2);
  });
});
