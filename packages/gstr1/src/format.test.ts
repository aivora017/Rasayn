import { describe, it, expect } from "vitest";
import {
  paiseToRupees,
  formatRupees2Dp,
  formatDateDDMMYYYY,
  fiscalYearFromPeriod,
  parsePeriod,
  buildPeriod,
  isoInPeriod,
  escapeCsv,
  sha256Hex,
} from "./format.js";

describe("format", () => {
  it("paiseToRupees converts at 100:1 boundary", () => {
    expect(paiseToRupees(0)).toBe(0);
    expect(paiseToRupees(100)).toBe(1);
    expect(paiseToRupees(12345)).toBe(123.45);
    expect(paiseToRupees(99)).toBe(0.99);
  });

  it("paiseToRupees avoids -0", () => {
    expect(Object.is(paiseToRupees(0), -0)).toBe(false);
  });

  it("formatRupees2Dp renders 2dp with leading zero", () => {
    expect(formatRupees2Dp(100)).toBe("1.00");
    expect(formatRupees2Dp(7)).toBe("0.07");
    expect(formatRupees2Dp(12345)).toBe("123.45");
    expect(formatRupees2Dp(0)).toBe("0.00");
    expect(formatRupees2Dp(-50)).toBe("-0.50");
  });

  it("formatDateDDMMYYYY reformats ISO", () => {
    expect(formatDateDDMMYYYY("2026-03-15T10:30:00.000Z")).toBe("15-03-2026");
    expect(formatDateDDMMYYYY("2026-03-15")).toBe("15-03-2026");
    expect(() => formatDateDDMMYYYY("15-03-2026")).toThrow();
  });

  it("fiscalYearFromPeriod computes FY with April cutoff", () => {
    expect(fiscalYearFromPeriod("042026")).toBe("2026-27");
    expect(fiscalYearFromPeriod("032026")).toBe("2025-26");
    expect(fiscalYearFromPeriod("122025")).toBe("2025-26");
    expect(fiscalYearFromPeriod("012026")).toBe("2025-26");
  });

  it("parsePeriod + buildPeriod round-trip", () => {
    const p = parsePeriod("032026");
    expect(p).toEqual({ mm: "03", yyyy: "2026" });
    expect(buildPeriod(p.mm, p.yyyy)).toBe("032026");
  });

  it("parsePeriod rejects invalid", () => {
    expect(() => parsePeriod("13/2026")).toThrow();
    expect(() => parsePeriod("1320262")).toThrow();
    expect(() => parsePeriod("132026")).toThrow();
  });

  it("isoInPeriod honours IST boundary — March 31 11:59 pm IST stays in March", () => {
    // Mar 31 2026 23:30 IST = Mar 31 18:00 UTC
    expect(isoInPeriod("2026-03-31T18:00:00.000Z", "03", "2026")).toBe(true);
    // Apr 1 00:30 IST = Mar 31 19:00 UTC — should be APR period, not March
    expect(isoInPeriod("2026-03-31T19:00:00.000Z", "03", "2026")).toBe(false);
    expect(isoInPeriod("2026-03-31T19:00:00.000Z", "04", "2026")).toBe(true);
  });

  it("escapeCsv quotes fields containing comma/quote/newline", () => {
    expect(escapeCsv("hello")).toBe("hello");
    expect(escapeCsv("hello,world")).toBe('"hello,world"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsv(42)).toBe("42");
    expect(escapeCsv("")).toBe("");
  });

  it("sha256Hex is 64-char hex for known input", async () => {
    const h = await sha256Hex("abc");
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
