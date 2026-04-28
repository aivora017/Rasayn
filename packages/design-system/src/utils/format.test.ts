import { describe, expect, it } from "vitest";
import { formatINR, formatINRCompact, formatNumber, formatPct } from "./format.js";

describe("formatINR", () => {
  it("formats paise with en-IN grouping", () => {
    // 12_345_678 paise → ₹1,23,456.78 (en-IN: 2-digit groups after first 3)
    expect(formatINR(12_345_678)).toMatch(/₹\s?1,23,456\.78/);
  });
  it("formats zero", () => {
    expect(formatINR(0)).toMatch(/₹\s?0\.00/);
  });
  it("accepts bigint", () => {
    expect(formatINR(BigInt(99_900))).toMatch(/₹\s?999\.00/);
  });
});

describe("formatINRCompact", () => {
  it("uses lakh shorthand for ≥ 1 L", () => {
    // 12_345_678 paise = ₹1,23,456.78 → 1.23 L
    expect(formatINRCompact(12_345_678)).toBe("₹1.23 L");
  });
  it("uses crore shorthand for ≥ 1 Cr", () => {
    // 12_35_00_00_000 paise = ₹12,35,00,000 → 12.35 Cr
    expect(formatINRCompact(12_35_00_00_000)).toBe("₹12.35 Cr");
  });
  it("uses K for ≥ ₹1,000 and < ₹1 L", () => {
    // 50_00_000 paise = ₹50,000 → 50.0K
    expect(formatINRCompact(50_00_000)).toBe("₹50.0K");
    // 1_50_000 paise = ₹1,500 → 1.5K
    expect(formatINRCompact(1_50_000)).toBe("₹1.5K");
  });
  it("returns rupee figure for sub-₹1k", () => {
    // 50_000 paise = ₹500 → "₹500"
    expect(formatINRCompact(50_000)).toBe("₹500");
    // 75_000 paise = ₹750 → "₹750"
    expect(formatINRCompact(75_000)).toBe("₹750");
  });
});

describe("formatNumber", () => {
  it("uses en-IN grouping", () => {
    expect(formatNumber(1_23_456)).toBe("1,23,456");
  });
});

describe("formatPct", () => {
  it("prefixes plus for positive", () => {
    expect(formatPct(12.345)).toBe("+12.3%");
  });
  it("uses unicode minus for negative", () => {
    expect(formatPct(-2.1)).toBe("−2.1%");
  });
  it("zero has no sign", () => {
    expect(formatPct(0)).toBe("0.0%");
  });
});
