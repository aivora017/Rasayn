import { describe, it, expect } from "vitest";
import {
  paiseToRupees,
  isoToIstDdMmYyyy,
  isValidGstinShape,
  isValidHsn,
  isValidInvoiceNo,
  isValidPin,
  isValidStateCode,
} from "./format.js";

describe("paiseToRupees", () => {
  it("converts 11800 paise -> 118", () => {
    expect(paiseToRupees(11800)).toBe(118);
  });
  it("converts 11850 paise -> 118.5", () => {
    expect(paiseToRupees(11850)).toBe(118.5);
  });
  it("converts 1234567 paise -> 12345.67", () => {
    expect(paiseToRupees(1234567)).toBe(12345.67);
  });
  it("handles zero", () => {
    expect(paiseToRupees(0)).toBe(0);
  });
  it("handles negative round-off", () => {
    expect(paiseToRupees(-42)).toBe(-0.42);
  });
  it("rounds half-away-from-zero", () => {
    // 0.125 * 100 = 12.5 → half-up -> 13 -> 0.13
    expect(paiseToRupees(12.5)).toBeCloseTo(0.13, 2);
  });
});

describe("isoToIstDdMmYyyy", () => {
  it("converts a UTC afternoon to same IST day", () => {
    expect(isoToIstDdMmYyyy("2026-04-17T10:00:00Z")).toBe("17/04/2026");
  });
  it("rolls over to next day when UTC is late evening", () => {
    // 20:00 UTC + 5:30 = 01:30 next day IST
    expect(isoToIstDdMmYyyy("2026-04-17T20:00:00Z")).toBe("18/04/2026");
  });
  it("handles leap-year boundary", () => {
    expect(isoToIstDdMmYyyy("2028-02-29T05:00:00Z")).toBe("29/02/2028");
  });
  it("throws on invalid iso", () => {
    expect(() => isoToIstDdMmYyyy("not-a-date")).toThrow();
  });
});

describe("isValidGstinShape", () => {
  it("accepts Maharashtra seller GSTIN", () => {
    expect(isValidGstinShape("27AAAPL1234C1ZV")).toBe(true);
  });
  it("rejects wrong length", () => {
    expect(isValidGstinShape("27AAAPL1234C1Z")).toBe(false);
  });
  it("rejects non-uppercase letters", () => {
    expect(isValidGstinShape("27aaapl1234c1zv")).toBe(false);
  });
  it("rejects bad state prefix", () => {
    expect(isValidGstinShape("AAAPL1234C1ZV27")).toBe(false);
  });
  it("rejects empty", () => {
    expect(isValidGstinShape("")).toBe(false);
  });
});

describe("isValidHsn", () => {
  it("accepts 6-digit", () => {
    expect(isValidHsn("300410")).toBe(true);
  });
  it("accepts 8-digit", () => {
    expect(isValidHsn("30041090")).toBe(true);
  });
  it("rejects 4-digit", () => {
    expect(isValidHsn("3004")).toBe(false);
  });
  it("rejects alpha", () => {
    expect(isValidHsn("300410A")).toBe(false);
  });
});

describe("isValidInvoiceNo", () => {
  it("accepts standard format", () => {
    expect(isValidInvoiceNo("INV-001")).toBe(true);
  });
  it("accepts 16 chars", () => {
    expect(isValidInvoiceNo("INV/2026-04/0001")).toBe(true);
  });
  it("rejects 17 chars", () => {
    expect(isValidInvoiceNo("INV/2026-04/00015")).toBe(false);
  });
  it("rejects empty", () => {
    expect(isValidInvoiceNo("")).toBe(false);
  });
  it("rejects special chars", () => {
    expect(isValidInvoiceNo("INV#001")).toBe(false);
  });
});

describe("isValidPin + isValidStateCode", () => {
  it("PIN 400001 OK", () => {
    expect(isValidPin(400001)).toBe(true);
  });
  it("PIN 99999 too short", () => {
    expect(isValidPin(99999)).toBe(false);
  });
  it("state 27 OK", () => {
    expect(isValidStateCode("27")).toBe(true);
  });
  it("state 1 too short", () => {
    expect(isValidStateCode("1")).toBe(false);
  });
});
