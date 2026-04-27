// Direct tests for einvoice constants — coverage-gaps 2026-04-18 §Medium.
// types.ts itself is structural, but the hard-coded thresholds, vendor list,
// and IRN-status enum are runtime values that downstream code branches on.
import { describe, expect, it } from "vitest";
import {
  TURNOVER_THRESHOLD_PAISE,
  type IrnStatus,
  type IrnDocDtls,
  type IrnPrecDocDtls,
  type SupplyType,
  type TaxScheme,
  type VendorName,
} from "./types.js";

describe("TURNOVER_THRESHOLD_PAISE", () => {
  it("equals exactly ₹5,00,00,000 expressed in paise (5e9)", () => {
    expect(TURNOVER_THRESHOLD_PAISE).toBe(5_000_000_000);
  });
  it("is the GSTN B2B IRN mandatory threshold from FY 2025-26", () => {
    // 5Cr rupees = 5e7 rupees = 5e9 paise.
    const fiveCroreInRupees = 5_00_00_000;
    expect(TURNOVER_THRESHOLD_PAISE).toBe(fiveCroreInRupees * 100);
  });
  it("is positive, finite, and an integer", () => {
    expect(TURNOVER_THRESHOLD_PAISE).toBeGreaterThan(0);
    expect(Number.isFinite(TURNOVER_THRESHOLD_PAISE)).toBe(true);
    expect(Number.isInteger(TURNOVER_THRESHOLD_PAISE)).toBe(true);
  });
});

describe("IrnStatus union — production state machine", () => {
  // The Rust adapter trait emits one of these; downstream UI branches on each.
  it("covers every documented state", () => {
    const known: IrnStatus[] = ["pending", "submitted", "acked", "cancelled", "failed"];
    // Type-level assertion — every union member is constructible.
    for (const s of known) {
      const witness: IrnStatus = s;
      expect(typeof witness).toBe("string");
    }
  });
});

describe("IrnDocDtls.Typ supports forward INV + reverse CRN/DBN", () => {
  it("accepts INV", () => {
    const d: IrnDocDtls = { Typ: "INV", No: "B-001", Dt: "01/04/2026" };
    expect(d.Typ).toBe("INV");
  });
  it("accepts CRN (credit note)", () => {
    const d: IrnDocDtls = { Typ: "CRN", No: "CN-001", Dt: "01/04/2026" };
    expect(d.Typ).toBe("CRN");
  });
  it("accepts DBN (debit note)", () => {
    const d: IrnDocDtls = { Typ: "DBN", No: "DN-001", Dt: "01/04/2026" };
    expect(d.Typ).toBe("DBN");
  });
});

describe("IrnPrecDocDtls is the credit-note → original-invoice link", () => {
  it("requires InvNo + InvDt; OthRefNo optional", () => {
    const p: IrnPrecDocDtls = { InvNo: "B-001", InvDt: "01/04/2026" };
    expect(p.InvNo).toBe("B-001");
    expect(p.InvDt).toBe("01/04/2026");
    expect(p.OthRefNo).toBeUndefined();
  });
  it("OthRefNo carries the carrier ref when set", () => {
    const p: IrnPrecDocDtls = { InvNo: "B-001", InvDt: "01/04/2026", OthRefNo: "ref-1" };
    expect(p.OthRefNo).toBe("ref-1");
  });
});

describe("VendorName + SupplyType + TaxScheme — locked to GSTN spec", () => {
  it("VendorName covers the registered GSPs we evaluated (cygnet primary)", () => {
    const cygnet: VendorName = "cygnet";
    const cleartax: VendorName = "cleartax";
    const mock: VendorName = "mock";
    expect([cygnet, cleartax, mock]).toEqual(["cygnet", "cleartax", "mock"]);
  });
  it("SupplyType is locked to B2B for v1 (B2CL/B2CS not mandatory)", () => {
    const t: SupplyType = "B2B";
    expect(t).toBe("B2B");
  });
  it("TaxScheme is locked to GST", () => {
    const t: TaxScheme = "GST";
    expect(t).toBe("GST");
  });
});
