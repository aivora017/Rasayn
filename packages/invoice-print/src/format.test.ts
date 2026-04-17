import { describe, expect, it } from "vitest";
import { amountInWords, escapeHtml, formatDate, formatDateTime, formatQty, formatRupees } from "./format.js";

describe("formatRupees", () => {
  it("formats Indian grouping", () => {
    expect(formatRupees(0)).toBe("0.00");
    expect(formatRupees(50)).toBe("0.50");
    expect(formatRupees(12345)).toBe("123.45");
    expect(formatRupees(100000)).toBe("1,000.00");
    expect(formatRupees(10000000)).toBe("1,00,000.00");
    expect(formatRupees(1000000000)).toBe("1,00,00,000.00");
  });
  it("handles negatives (round-off)", () => {
    expect(formatRupees(-12)).toBe("-0.12");
    expect(formatRupees(-100000)).toBe("-1,000.00");
  });
});

describe("formatQty", () => {
  it("strips trailing zeros", () => {
    expect(formatQty(1)).toBe("1");
    expect(formatQty(1.5)).toBe("1.5");
    expect(formatQty(2.250)).toBe("2.25");
  });
});

describe("amountInWords", () => {
  it("covers zero, ones, teens, tens, hundreds", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(100)).toBe("Rupees One Only");
    expect(amountInWords(1900)).toBe("Rupees Nineteen Only");
  });
  it("adds paise when non-zero", () => {
    expect(amountInWords(105)).toBe("Rupees One and Five Paise Only");
    expect(amountInWords(10050)).toBe("Rupees One Hundred and Fifty Paise Only");
  });
  it("Indian thousands/lakhs/crores", () => {
    expect(amountInWords(100000 * 100)).toContain("One Lakh");
    expect(amountInWords(12345678 * 100)).toContain("Crore");
    expect(amountInWords(12345678 * 100)).toContain("Lakh");
    expect(amountInWords(12345678 * 100)).toContain("Thousand");
  });
});

describe("escapeHtml", () => {
  it("escapes <>&\"'", () => {
    expect(escapeHtml(`<b>"Tom & Jerry"</b>`)).toBe("&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;");
    expect(escapeHtml("It's")).toBe("It&#39;s");
  });
});

describe("formatDateTime / formatDate", () => {
  it("renders ISO with UTC-stable mon/dd", () => {
    expect(formatDateTime("2026-04-17T14:03:00.000Z")).toBe("17-Apr-2026 14:03");
    expect(formatDate("2027-03-31")).toBe("31-Mar-2027");
  });
  it("passes through garbage", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});
