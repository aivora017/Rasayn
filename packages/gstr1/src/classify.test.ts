import { describe, it, expect } from "vitest";
import { classifyBill, hasExemptSurface, validateBillForGstr1, placeOfSupply } from "./classify.js";
import { makeBill, makeCustomer, makeLine } from "./fixtures.js";

describe("classifyBill", () => {
  it("B2B when customer has 15-char GSTIN", () => {
    const b = makeBill({ customer: makeCustomer({ gstin: "27ABCDE1234F1Z5" }) });
    expect(classifyBill(b)).toBe("b2b");
  });

  it("B2CL for interstate unregistered > ₹1L", () => {
    const b = makeBill({
      customer: makeCustomer({ stateCode: "07" }),
      gstTreatment: "inter_state",
      grandTotalPaise: 1_00_00_001, // ₹1L + 1 paise
    });
    expect(classifyBill(b)).toBe("b2cl");
  });

  it("B2CS for interstate unregistered ≤ ₹1L", () => {
    const b = makeBill({
      customer: makeCustomer({ stateCode: "07" }),
      gstTreatment: "inter_state",
      grandTotalPaise: 1_00_00_000, // exactly ₹1L → B2CS (rule: strictly greater)
    });
    expect(classifyBill(b)).toBe("b2cs");
  });

  it("B2CS for intrastate unregistered at any value", () => {
    const b = makeBill({
      customer: makeCustomer(),
      gstTreatment: "intra_state",
      grandTotalPaise: 5_00_00_000,
    });
    expect(classifyBill(b)).toBe("b2cs");
  });

  it("null customer → B2CS", () => {
    const b = makeBill({ customer: null });
    expect(classifyBill(b)).toBe("b2cs");
  });

  it("whitespace-only GSTIN treated as unregistered", () => {
    const b = makeBill({ customer: makeCustomer({ gstin: "   " }) });
    expect(classifyBill(b)).toBe("b2cs");
  });

  it("wrong-length GSTIN treated as unregistered", () => {
    const b = makeBill({ customer: makeCustomer({ gstin: "SHORT" }) });
    expect(classifyBill(b)).toBe("b2cs");
  });
});

describe("hasExemptSurface", () => {
  it("true when any 0-rate line", () => {
    const b = makeBill({ lines: [makeLine({ gstRate: 0 })] });
    expect(hasExemptSurface(b)).toBe(true);
  });
  it("true when treatment exempt", () => {
    const b = makeBill({ gstTreatment: "exempt" });
    expect(hasExemptSurface(b)).toBe(true);
  });
  it("true when treatment nil_rated", () => {
    const b = makeBill({ gstTreatment: "nil_rated" });
    expect(hasExemptSurface(b)).toBe(true);
  });
  it("false for normal taxable bill", () => {
    const b = makeBill();
    expect(hasExemptSurface(b)).toBe(false);
  });
});

describe("validateBillForGstr1", () => {
  it("valid bill returns empty reasons", () => {
    expect(validateBillForGstr1(makeBill(), "27")).toEqual([]);
  });
  it("flags voided bill", () => {
    const r = validateBillForGstr1(makeBill({ isVoided: 1 }), "27");
    expect(r).toContain("bill is voided");
  });
  it("flags empty lines", () => {
    const r = validateBillForGstr1(makeBill({ lines: [] }), "27");
    expect(r).toContain("no lines");
  });
  it("flags missing HSN", () => {
    const r = validateBillForGstr1(makeBill({ lines: [makeLine({ hsn: "" })] }), "27");
    expect(r.some((x) => x.includes("missing HSN"))).toBe(true);
  });
  it("flags wrong-length GSTIN", () => {
    const r = validateBillForGstr1(
      makeBill({ customer: makeCustomer({ gstin: "SHORT" }) }),
      "27",
    );
    expect(r.some((x) => x.includes("GSTIN wrong length"))).toBe(true);
  });
  it("flags interstate bill with same-state customer", () => {
    const r = validateBillForGstr1(
      makeBill({ gstTreatment: "inter_state", customer: makeCustomer({ stateCode: "27" }) }),
      "27",
    );
    expect(r.some((x) => x.includes("customer state matches shop state"))).toBe(true);
  });
  it("flags intrastate bill with other-state customer", () => {
    const r = validateBillForGstr1(
      makeBill({ gstTreatment: "intra_state", customer: makeCustomer({ stateCode: "07" }) }),
      "27",
    );
    expect(r.some((x) => x.includes("customer state ≠ shop state"))).toBe(true);
  });
});

describe("placeOfSupply", () => {
  it("prefers customer.stateCode", () => {
    const b = makeBill({ customer: makeCustomer({ stateCode: "07" }) });
    expect(placeOfSupply(b, "27")).toBe("07");
  });
  it("falls back to first 2 chars of GSTIN", () => {
    const b = makeBill({
      customer: makeCustomer({ stateCode: null, gstin: "09ABCDE1234F1Z5" }),
    });
    expect(placeOfSupply(b, "27")).toBe("09");
  });
  it("falls back to shop state", () => {
    const b = makeBill({ customer: makeCustomer({ stateCode: null, gstin: null }) });
    expect(placeOfSupply(b, "27")).toBe("27");
  });
});
