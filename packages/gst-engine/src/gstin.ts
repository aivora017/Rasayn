// @pharmacare/gst-engine — GSTIN format validator
//
// GSTIN (Goods & Services Tax Identification Number) is a 15-character
// PAN-anchored identifier issued by the Indian GST council. Layout:
//
//   positions 1..2   = state code (numeric, 01..38; "97" = OIDAR; "99" = invalid)
//   positions 3..12  = entity PAN (5 letters, 4 digits, 1 letter — see PAN regex)
//   position  13     = entity sequence within PAN (alphanumeric, 1..Z)
//   position  14     = "Z" (constant for normal taxpayers)
//   position  15     = checksum (Mod-36 over positions 1..14)
//
// Reference: CBIC GSTIN structure note (Notification 60/2018-CT) +
// Mod-36 checksum algorithm published in CBIC's GSTIN technical guide.
//
// This validator is a HARD GATE for the OnboardingWizard "Save shop"
// button (S28-B3). It returns a structured failure with the offending
// sub-field so the UI can highlight the exact problem (length vs.
// state-code vs. checksum) instead of a generic "invalid" error.

/** Indian GST state codes — entries are numeric strings padded to 2 chars. */
export const GST_STATE_CODES: ReadonlyMap<string, string> = new Map([
  ["01", "Jammu and Kashmir"],
  ["02", "Himachal Pradesh"],
  ["03", "Punjab"],
  ["04", "Chandigarh"],
  ["05", "Uttarakhand"],
  ["06", "Haryana"],
  ["07", "Delhi"],
  ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"],
  ["10", "Bihar"],
  ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"],
  ["14", "Manipur"],
  ["15", "Mizoram"],
  ["16", "Tripura"],
  ["17", "Meghalaya"],
  ["18", "Assam"],
  ["19", "West Bengal"],
  ["20", "Jharkhand"],
  ["21", "Odisha"],
  ["22", "Chhattisgarh"],
  ["23", "Madhya Pradesh"],
  ["24", "Gujarat"],
  ["25", "Daman and Diu"],
  ["26", "Dadra and Nagar Haveli"],
  ["27", "Maharashtra"],
  ["28", "Andhra Pradesh (old)"],
  ["29", "Karnataka"],
  ["30", "Goa"],
  ["31", "Lakshadweep"],
  ["32", "Kerala"],
  ["33", "Tamil Nadu"],
  ["34", "Puducherry"],
  ["35", "Andaman and Nicobar Islands"],
  ["36", "Telangana"],
  ["37", "Andhra Pradesh (new)"],
  ["38", "Ladakh"],
  ["97", "Other Territory (OIDAR)"],
]);

/** Mod-36 alphabet: 0..9 then A..Z. */
const MOD36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** PAN regex (5 letters, 4 digits, 1 letter). */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export type GstinFailField =
  | "length"
  | "charset"
  | "stateCode"
  | "pan"
  | "entityNo"
  | "checkLetter"
  | "checksum";

export interface GstinOk {
  readonly ok: true;
  readonly stateCode: string;
  readonly stateName: string;
  readonly pan: string;
}

export interface GstinFail {
  readonly ok: false;
  readonly field: GstinFailField;
  readonly message: string;
}

export type GstinValidationResult = GstinOk | GstinFail;

/**
 * Compute the Mod-36 checksum digit for the first 14 chars of a GSTIN.
 * Algorithm (CBIC technical guide):
 *   - For each of the 14 chars, look up its position in MOD36 alphabet (0..35).
 *   - Multiply odd-indexed positions (1,3,5,...) by 1; even-indexed (2,4,...) by 2.
 *     (1-based — i.e. the FIRST char is multiplied by 1, the SECOND by 2, etc.)
 *   - For each product, if it's >= 36, take its quotient + remainder when divided
 *     by 36 and sum BOTH digits. (Equivalent to: subtract 36 once if >= 36.)
 *   - Sum the resulting values.
 *   - checksum = (36 - (sum mod 36)) mod 36, mapped back to MOD36 alphabet.
 */
export function computeGstinChecksum(first14: string): string {
  if (first14.length !== 14) {
    throw new Error("computeGstinChecksum: expected 14-char input");
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const ch = first14[i]!;
    const v = MOD36.indexOf(ch);
    if (v < 0) {
      throw new Error(`computeGstinChecksum: char "${ch}" not in MOD36 alphabet`);
    }
    // 1-based position; even (i % 2 === 1 in 0-based) -> factor 2
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = v * factor;
    // Sum digits in base-36: q + r when prod >= 36.
    const q = Math.floor(prod / 36);
    const r = prod % 36;
    sum += q + r;
  }
  const checksum = (36 - (sum % 36)) % 36;
  return MOD36[checksum]!;
}

/**
 * Validate a GSTIN string. Returns a discriminated result with the offending
 * sub-field on failure so the UI can highlight the specific problem.
 *
 * The validator is INTENTIONALLY strict — uppercase only, no whitespace
 * tolerance — because the wizard normalizes input (`.toUpperCase().trim()`)
 * before calling. Looser pre-processing belongs in the UI, not here.
 */
export function validateGstin(input: string): GstinValidationResult {
  if (input.length !== 15) {
    return {
      ok: false,
      field: "length",
      message: `GSTIN must be exactly 15 characters (got ${input.length})`,
    };
  }
  // Charset: uppercase letters + digits only.
  for (let i = 0; i < 15; i++) {
    if (MOD36.indexOf(input[i]!) < 0) {
      return {
        ok: false,
        field: "charset",
        message: `Character "${input[i]}" at position ${i + 1} is not A-Z or 0-9`,
      };
    }
  }
  const stateCode = input.slice(0, 2);
  if (!GST_STATE_CODES.has(stateCode)) {
    return {
      ok: false,
      field: "stateCode",
      message: `State code "${stateCode}" is not a recognised Indian GST state`,
    };
  }
  const pan = input.slice(2, 12);
  if (!PAN_RE.test(pan)) {
    return {
      ok: false,
      field: "pan",
      message: `Embedded PAN "${pan}" does not match AAAAA9999A`,
    };
  }
  const entityNo = input[12]!;
  if (MOD36.indexOf(entityNo) < 0) {
    return {
      ok: false,
      field: "entityNo",
      message: `Entity sequence "${entityNo}" is not alphanumeric`,
    };
  }
  const checkLetter = input[13]!;
  if (checkLetter !== "Z") {
    return {
      ok: false,
      field: "checkLetter",
      message: `Position 14 must be "Z" for normal taxpayers (got "${checkLetter}")`,
    };
  }
  const expected = computeGstinChecksum(input.slice(0, 14));
  if (expected !== input[14]) {
    return {
      ok: false,
      field: "checksum",
      message: `Mod-36 checksum mismatch (expected "${expected}", got "${input[14]}")`,
    };
  }
  return {
    ok: true,
    stateCode,
    stateName: GST_STATE_CODES.get(stateCode)!,
    pan,
  };
}

/** Convenience boolean wrapper. */
export function isValidGstin(input: string): boolean {
  return validateGstin(input).ok;
}
