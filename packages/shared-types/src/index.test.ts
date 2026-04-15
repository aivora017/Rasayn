import { describe, it, expect } from "vitest";
import {
  SHARED_TYPES_VERSION,
  paise, rupeesToPaise, paiseToRupees, addP, subP, mulP, formatINR,
  asProductId, asBatchId,
} from "./index.js";

describe("money primitives", () => {
  it("rounds rupees to paise without float drift", () => {
    expect(rupeesToPaise(12.345)).toBe(1235);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });
  it("round-trips paise -> rupees", () => {
    expect(paiseToRupees(rupeesToPaise(99.99))).toBe(99.99);
  });
  it("adds/subs/muls paise as integers", () => {
    expect(addP(paise(100), paise(250))).toBe(350);
    expect(subP(paise(500), paise(199))).toBe(301);
    expect(mulP(paise(100), 3)).toBe(300);
  });
  it("formats INR en-IN", () => {
    const s = formatINR(paise(1234567));
    expect(s).toMatch(/12,345\.67/);
  });
  it("rejects non-finite input", () => {
    expect(() => paise(NaN)).toThrow();
    expect(() => paise(Infinity)).toThrow();
  });
  it("version bumped", () => {
    expect(SHARED_TYPES_VERSION).toBe("0.2.0");
  });
});

describe("branded ids", () => {
  it("accepts assertion helpers", () => {
    const p = asProductId("prod_123");
    const b = asBatchId("batch_456");
    expect(p).toBe("prod_123");
    expect(b).toBe("batch_456");
  });
});
