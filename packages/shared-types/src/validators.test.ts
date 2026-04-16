import { describe, it, expect } from "vitest";
import {
  isPharmaHsn,
  validateHsn,
  validateGstRate,
  validateNppaCap,
  validateScheduleImage,
  validateProductWrite,
  PHARMA_HSN,
} from "./validators.js";

describe("validators — HSN", () => {
  it("accepts the pharma whitelist", () => {
    for (const h of PHARMA_HSN) expect(isPharmaHsn(h)).toBe(true);
  });
  it("rejects 4-digit non-pharma HSN", () => {
    expect(validateHsn("9999")).toMatch(/pharma retail/);
  });
  it("rejects wrong length", () => {
    expect(validateHsn("300")).toMatch(/4-digit/);
    expect(validateHsn("30040")).toMatch(/4-digit/);
  });
  it("rejects empty", () => {
    expect(validateHsn("")).toMatch(/required/);
  });
});

describe("validators — GST rate", () => {
  it("accepts 0/5/12/18/28", () => {
    for (const r of [0, 5, 12, 18, 28]) expect(validateGstRate(r)).toBe(true);
  });
  it("rejects 8, 10, 15", () => {
    for (const r of [8, 10, 15]) expect(validateGstRate(r)).toBe(false);
  });
});

describe("validators — NPPA cap", () => {
  it("passes when cap is null", () => {
    expect(validateNppaCap(9999, null)).toBeNull();
  });
  it("passes when MRP <= cap", () => {
    expect(validateNppaCap(3500, 4000)).toBeNull();
    expect(validateNppaCap(4000, 4000)).toBeNull();
  });
  it("fails when MRP > cap and quotes rupees", () => {
    const err = validateNppaCap(5000, 4000);
    expect(err).toMatch(/DPCO 2013/);
    expect(err).toMatch(/\u20B950\.00/);
    expect(err).toMatch(/\u20B940\.00/);
  });
});

describe("validators — Schedule image (X2 moat)", () => {
  it("requires image for H/H1/X", () => {
    expect(validateScheduleImage("H", null)).toMatch(/X2/);
    expect(validateScheduleImage("H1", "")).toMatch(/X2/);
    expect(validateScheduleImage("X", null)).toMatch(/X2/);
  });
  it("does not require image for OTC/G/NDPS", () => {
    expect(validateScheduleImage("OTC", null)).toBeNull();
    expect(validateScheduleImage("G", null)).toBeNull();
    expect(validateScheduleImage("NDPS", null)).toBeNull();
  });
  it("passes when image provided for H", () => {
    expect(validateScheduleImage("H", "abcd")).toBeNull();
  });
});

describe("validateProductWrite — composite", () => {
  const base = {
    name: "Crocin",
    manufacturer: "GSK",
    hsn: "3004",
    gstRate: 12,
    schedule: "OTC" as const,
    packSize: 15,
    mrpPaise: 3500,
    nppaMaxMrpPaise: 4000,
    imageSha256: null,
  };

  it("clean input yields no errors", () => {
    expect(validateProductWrite(base)).toEqual([]);
  });

  it("empty name + bad HSN + MRP over cap — all surfaced together", () => {
    const errs = validateProductWrite({
      ...base, name: "  ", hsn: "9999", mrpPaise: 5000, nppaMaxMrpPaise: 4000,
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
    expect(errs.some((e) => e.includes("name"))).toBe(true);
    expect(errs.some((e) => e.includes("pharma"))).toBe(true);
    expect(errs.some((e) => e.includes("NPPA"))).toBe(true);
  });

  it("Schedule H without image fails", () => {
    const errs = validateProductWrite({ ...base, schedule: "H", imageSha256: null });
    expect(errs.some((e) => e.includes("X2"))).toBe(true);
  });

  it("Schedule H with image passes", () => {
    const errs = validateProductWrite({ ...base, schedule: "H", imageSha256: "a".repeat(64) });
    expect(errs).toEqual([]);
  });

  it("negative pack size fails", () => {
    const errs = validateProductWrite({ ...base, packSize: 0 });
    expect(errs.some((e) => e.includes("pack_size"))).toBe(true);
  });
});
