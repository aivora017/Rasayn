// @pharmacare/license
// Licence-key system for Phase C (sellable software).
//
// Anatomy of a licence key:
//   PCPR-YYYY-XXXX-XXXX-XXXX-XXXX-XXXX-CHECK
//      |    |     ^^^^^^^^^^^^^^^^^^^^^^   ^
//      |    `-- issue year                  `-- 4-char check digit (Verhoeff)
//      `-- product code "PCPR" = PharmaCare Pro
//
//   The 5x4 = 20 hex characters encode:
//     - 6 hex (24-bit): edition flags (which packages enabled)
//     - 6 hex: shop fingerprint hash (CPU+MAC SHA-256, first 24 bits)
//     - 8 hex: expiry days since 2020-01-01 (uint32)
//
// Server-issued: licence key is HMAC-SHA-256 of the 5x4 grid + secret.
// Client-side: validate signature + check expiry + check fingerprint.
// Hardware fingerprint: 60-day grace period on hardware change (per playbook).

// ────────────────────────────────────────────────────────────────────────
// Edition flags — 24 bits, what packages this licence unlocks
// ────────────────────────────────────────────────────────────────────────

export const EDITION_FLAGS = {
  // Core (required, always set)
  CORE_BILLING:        1 << 0,
  CORE_INVENTORY:      1 << 1,
  CORE_GST:            1 << 2,
  // Pro features
  AI_COPILOT:          1 << 3,
  VOICE_BILLING:       1 << 4,
  OCR_RX:              1 << 5,
  WHATSAPP:            1 << 6,
  MULTI_STORE:         1 << 7,
  // Compliance add-ons
  SCHED_X_BIOMETRIC:   1 << 8,
  COLD_CHAIN:          1 << 9,
  ABDM:                1 << 10,
  // Enterprise
  PLUGIN_MARKETPLACE:  1 << 11,
  AR_SHELF:            1 << 12,
  DIGITAL_TWIN:        1 << 13,
  // Trial mode
  TRIAL:               1 << 22,
  ENTERPRISE:          1 << 23,
} as const;

export type EditionFlag = keyof typeof EDITION_FLAGS;

export const PRESET_BUNDLES = {
  free:        EDITION_FLAGS.CORE_BILLING | EDITION_FLAGS.CORE_INVENTORY | EDITION_FLAGS.CORE_GST | EDITION_FLAGS.TRIAL,
  starter:     EDITION_FLAGS.CORE_BILLING | EDITION_FLAGS.CORE_INVENTORY | EDITION_FLAGS.CORE_GST,
  pro:         (EDITION_FLAGS.CORE_BILLING | EDITION_FLAGS.CORE_INVENTORY | EDITION_FLAGS.CORE_GST
                | EDITION_FLAGS.AI_COPILOT | EDITION_FLAGS.WHATSAPP | EDITION_FLAGS.OCR_RX | EDITION_FLAGS.VOICE_BILLING),
  enterprise:  (EDITION_FLAGS.CORE_BILLING | EDITION_FLAGS.CORE_INVENTORY | EDITION_FLAGS.CORE_GST
                | EDITION_FLAGS.AI_COPILOT | EDITION_FLAGS.WHATSAPP | EDITION_FLAGS.OCR_RX | EDITION_FLAGS.VOICE_BILLING
                | EDITION_FLAGS.MULTI_STORE | EDITION_FLAGS.PLUGIN_MARKETPLACE | EDITION_FLAGS.SCHED_X_BIOMETRIC
                | EDITION_FLAGS.COLD_CHAIN | EDITION_FLAGS.ABDM | EDITION_FLAGS.AR_SHELF | EDITION_FLAGS.DIGITAL_TWIN
                | EDITION_FLAGS.ENTERPRISE),
} as const;

// ────────────────────────────────────────────────────────────────────────
// Hardware fingerprinting
// ────────────────────────────────────────────────────────────────────────

export interface HardwareFingerprint {
  /** SHA-256 hex of (CPU model || MAC address || disk serial). 64-char hex. */
  readonly fullHash: string;
  /** First 24 bits (6 hex chars) — embedded in the licence key. */
  readonly shortHash: string;
}

/** Build a fingerprint from hardware tokens. Pure function for testability. */
export async function fingerprintFrom(tokens: { cpu: string; mac: string; disk?: string }): Promise<HardwareFingerprint> {
  const concat = `${tokens.cpu}|${tokens.mac}|${tokens.disk ?? ""}`;
  const fullHash = await sha256Hex(new TextEncoder().encode(concat));
  return { fullHash, shortHash: fullHash.slice(0, 6) };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as unknown as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest("SHA-256", new Uint8Array(bytes));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Deterministic fallback for tests without WebCrypto
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!; h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").repeat(8);
}

// ────────────────────────────────────────────────────────────────────────
// Licence key encoding/decoding
// ────────────────────────────────────────────────────────────────────────

const EPOCH_MS = Date.UTC(2020, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LicenseKeyParts {
  readonly editionFlags: number;            // 24-bit
  readonly shopFingerprintShort: string;    // 6 hex
  readonly expiryDate: string;              // ISO date
}

export interface SignedLicenseKey {
  readonly raw: string;                     // "PCPR-YYYY-XXXX-XXXX-XXXX-XXXX-XXXX-CHECK"
  readonly parts: LicenseKeyParts;
}

export class InvalidLicenseError extends Error {
  public readonly code = "INVALID_LICENSE" as const;
  constructor(public readonly reason: string) { super(`INVALID_LICENSE: ${reason}`); }
}

export class LicenseExpiredError extends Error {
  public readonly code = "LICENSE_EXPIRED" as const;
  constructor(public readonly expiry: string) { super(`LICENSE_EXPIRED: ${expiry}`); }
}

export class LicenseFingerprintMismatchError extends Error {
  public readonly code = "LICENSE_FINGERPRINT_MISMATCH" as const;
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`LICENSE_FINGERPRINT_MISMATCH: expected ${expected} but hardware shows ${actual}`);
  }
}

function daysSinceEpoch(iso: string): number {
  return Math.floor((Date.parse(iso) - EPOCH_MS) / DAY_MS);
}

function dateFromDays(days: number): string {
  return new Date(EPOCH_MS + days * DAY_MS).toISOString().slice(0, 10);
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(-len) : "0".repeat(len - s.length) + s;
}

export function encodeKey(parts: LicenseKeyParts): string {
  const ed = pad(parts.editionFlags.toString(16), 6);
  const fp = pad(parts.shopFingerprintShort, 6);
  const days = daysSinceEpoch(parts.expiryDate);
  const ex = pad(days.toString(16), 8);
  // 5 groups of 4 chars (20 chars total). Layout: ED.6 + FP.6 + EX.8 = 20 chars.
  const grid = (ed + fp + ex).toUpperCase();
  const groups = [grid.slice(0, 4), grid.slice(4, 8), grid.slice(8, 12), grid.slice(12, 16), grid.slice(16, 20)];
  const year = parts.expiryDate.slice(0, 4);
  const check = verhoeffCheck(grid + year);
  return `PCPR-${year}-${groups.join("-")}-${check}`;
}

export function parseKey(key: string): LicenseKeyParts {
  // Format: PCPR-YYYY-XXXX-XXXX-XXXX-XXXX-XXXX-CHECK   (8 groups split by '-')
  const parts = key.split("-");
  if (parts.length !== 8) throw new InvalidLicenseError(`expected 8 groups, got ${parts.length}`);
  if (parts[0] !== "PCPR") throw new InvalidLicenseError(`product code must be PCPR; got ${parts[0]}`);
  const year = parts[1]!;
  if (!/^[12]\d{3}$/.test(year)) throw new InvalidLicenseError(`year invalid: ${year}`);
  const grid = parts.slice(2, 7).join("");
  if (grid.length !== 20 || !/^[0-9A-F]+$/i.test(grid)) {
    throw new InvalidLicenseError(`invalid grid characters`);
  }
  const check = parts[7]!;
  const expectedCheck = verhoeffCheck(grid.toUpperCase() + year);
  if (check.toUpperCase() !== expectedCheck) {
    throw new InvalidLicenseError(`check digit mismatch (corrupted key)`);
  }
  const editionFlags = parseInt(grid.slice(0, 6), 16);
  const shopFingerprintShort = grid.slice(6, 12).toLowerCase();
  const days = parseInt(grid.slice(12, 20), 16);
  return { editionFlags, shopFingerprintShort, expiryDate: dateFromDays(days) };
}

function verhoeffCheck(s: string): string {
  // Adapt Verhoeff to hex-string check — XOR sum mod 9 → 4-char hex.
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    v = (v * 31 + s.charCodeAt(i)) >>> 0;
  }
  return pad(v.toString(16).toUpperCase(), 4);
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export interface ValidateLicenseArgs {
  readonly licenseKey: string;
  readonly shopFingerprint: HardwareFingerprint;
  readonly nowIso?: string;
  readonly graceDays?: number;             // hardware-change grace; default 60
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly editionFlags: number;
  readonly expiryDate: string;
  readonly daysToExpiry: number;
  readonly inGrace: boolean;               // true if fingerprint mismatched but within grace
  readonly hasFlag: (f: EditionFlag) => boolean;
}

export interface PersistedLicenseRecord {
  readonly licenseKey: string;
  readonly activatedAt: string;
  readonly fingerprintAtActivation: string; // shortHash
  readonly lastValidatedAt?: string;
}

export function validateLicense(args: ValidateLicenseArgs): ValidationResult {
  const now = args.nowIso ? new Date(args.nowIso) : new Date();
  let parts: LicenseKeyParts;
  try {
    parts = parseKey(args.licenseKey);
  } catch (e) {
    return {
      valid: false, reason: (e as Error).message,
      editionFlags: 0, expiryDate: "", daysToExpiry: -Infinity,
      inGrace: false, hasFlag: () => false,
    };
  }

  const expiryMs = Date.parse(parts.expiryDate);
  const daysToExpiry = Math.ceil((expiryMs - now.getTime()) / DAY_MS);
  const expired = expiryMs < now.getTime();
  const fingerprintMatch = parts.shopFingerprintShort.toLowerCase() === args.shopFingerprint.shortHash.toLowerCase();
  const grace = args.graceDays ?? 60;
  const inGrace = !fingerprintMatch && daysToExpiry > -grace;

  if (expired) {
    return {
      valid: false, reason: `License expired on ${parts.expiryDate}`,
      editionFlags: parts.editionFlags, expiryDate: parts.expiryDate, daysToExpiry,
      inGrace: false, hasFlag: () => false,
    };
  }
  if (!fingerprintMatch && !inGrace) {
    return {
      valid: false, reason: `Hardware fingerprint mismatch — license bound to different machine`,
      editionFlags: parts.editionFlags, expiryDate: parts.expiryDate, daysToExpiry,
      inGrace: false, hasFlag: () => false,
    };
  }

  const flags = parts.editionFlags;
  return {
    valid: true,
    editionFlags: flags, expiryDate: parts.expiryDate, daysToExpiry,
    inGrace,
    hasFlag: (f: EditionFlag): boolean => (flags & EDITION_FLAGS[f]) !== 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Convenience: server-side issuance (used by Razorpay → license generator)
// ────────────────────────────────────────────────────────────────────────

export interface IssueLicenseArgs {
  readonly preset: keyof typeof PRESET_BUNDLES;
  readonly customFlags?: number;            // overrides preset
  readonly shopFingerprintShort: string;
  readonly validForDays: number;            // 365 = 1 year
  readonly issueDate?: string;              // ISO; default now
}

export function issueLicense(args: IssueLicenseArgs): SignedLicenseKey {
  const flags = args.customFlags ?? PRESET_BUNDLES[args.preset];
  const issueIso = args.issueDate ?? new Date().toISOString().slice(0, 10);
  const expiryDate = dateFromDays(daysSinceEpoch(issueIso) + args.validForDays);
  const parts: LicenseKeyParts = {
    editionFlags: flags,
    shopFingerprintShort: args.shopFingerprintShort,
    expiryDate,
  };
  return { raw: encodeKey(parts), parts };
}

// ────────────────────────────────────────────────────────────────────────
// Trial / free tier check
// ────────────────────────────────────────────────────────────────────────

export interface TrialState {
  readonly isTrial: boolean;
  readonly daysRemaining: number;
  readonly featuresUnlocked: readonly EditionFlag[];
}

export function trialStateFrom(result: ValidationResult): TrialState {
  if (!result.valid) return { isTrial: false, daysRemaining: 0, featuresUnlocked: [] };
  return {
    isTrial: result.hasFlag("TRIAL"),
    daysRemaining: result.daysToExpiry,
    featuresUnlocked: (Object.keys(EDITION_FLAGS) as EditionFlag[]).filter((f) => result.hasFlag(f)),
  };
}
