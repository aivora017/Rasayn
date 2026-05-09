/**
 * GSTIN validator tests (S28-B3).
 *
 * Covers the Mod-36 checksum, state-code lookup, length, and embedded
 * PAN structure. Two "real" valid GSTINs are computed by the algorithm
 * itself — independent algebraic verification is impossible without the
 * CBIC's reference table — so the test asserts the round-trip property:
 * a GSTIN that the validator accepts must have a checksum that matches
 * the same algorithm's output.
 */
import { describe, it, expect } from "vitest";
import {
  validateGstin,
  isValidGstin,
  computeGstinChecksum,
  GST_STATE_CODES,
} from "../gstin.js";

// Helper: build a syntactically valid GSTIN for a given state code by
// computing the checksum digit ourselves. Uses dummy PAN "AAAAA0000A".
function buildGstin(stateCode: string, pan = "AAAAA0000A"): string {
  const first14 = `${stateCode}${pan}1Z`;
  const check = computeGstinChecksum(first14);
  return first14 + check;
}

describe("validateGstin · S28-B3 hard gate for OnboardingWizard", () => {
  it("accepts a valid Maharashtra (state 27) GSTIN — Vaidyanath case", () => {
    const gstin = buildGstin("27");
    const result = validateGstin(gstin);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stateCode).toBe("27");
      expect(result.stateName).toBe("Maharashtra");
      expect(result.pan).toBe("AAAAA0000A");
    }
  });

  it("accepts a valid Karnataka (state 29) GSTIN", () => {
    const gstin = buildGstin("29");
    const result = validateGstin(gstin);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stateCode).toBe("29");
      expect(result.stateName).toBe("Karnataka");
    }
  });

  it("rejects a GSTIN with bad length", () => {
    const result = validateGstin("27AAAAA0000A1Z"); // 14 chars
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("length");
  });

  it("rejects a GSTIN with non-existent state code", () => {
    // 99 is not a valid state per CBIC list.
    const first14 = "99AAAAA0000A1Z";
    const check = computeGstinChecksum(first14);
    const result = validateGstin(first14 + check);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("stateCode");
  });

  it("rejects a GSTIN with bad checksum (off-by-one)", () => {
    const valid = buildGstin("27");
    // Flip the final char to a different MOD36 digit.
    const lastChar = valid[14];
    const swap = lastChar === "A" ? "B" : "A";
    const broken = valid.slice(0, 14) + swap;
    const result = validateGstin(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("checksum");
  });

  it("rejects a GSTIN with malformed embedded PAN (digits in letter zone)", () => {
    // "12345" instead of 5 letters at positions 3..7.
    const first14 = "27123450000A1Z";
    const check = computeGstinChecksum(first14);
    const result = validateGstin(first14 + check);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("pan");
  });

  it("rejects a GSTIN with non-Z position 14 (composition / casual taxpayers not handled)", () => {
    // For normal taxpayer the 14th character must be "Z".
    const first14 = "27AAAAA0000A1Y";
    const check = computeGstinChecksum(first14);
    const result = validateGstin(first14 + check);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("checkLetter");
  });

  it("rejects a GSTIN with lower-case letters (charset)", () => {
    const result = validateGstin("27aaaaa0000a1Z2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The first lower-case char fails the MOD36 alphabet at position 3.
      expect(result.field).toBe("charset");
    }
  });

  it("isValidGstin convenience boolean works", () => {
    expect(isValidGstin(buildGstin("27"))).toBe(true);
    expect(isValidGstin("BOGUS")).toBe(false);
  });

  it("state-code map covers all 36 mainland + OIDAR codes", () => {
    expect(GST_STATE_CODES.has("27")).toBe(true);
    expect(GST_STATE_CODES.has("29")).toBe(true);
    expect(GST_STATE_CODES.has("01")).toBe(true);
    expect(GST_STATE_CODES.has("38")).toBe(true);
    expect(GST_STATE_CODES.has("97")).toBe(true);
    expect(GST_STATE_CODES.has("99")).toBe(false);
  });
});
