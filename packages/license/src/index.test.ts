import { describe, it, expect } from "vitest";
import {
  encodeKey, parseKey, validateLicense, issueLicense, trialStateFrom,
  fingerprintFrom, EDITION_FLAGS, PRESET_BUNDLES,
  InvalidLicenseError,
} from "./index.js";

const TEST_FP = { fullHash: "deadbeef".repeat(8), shortHash: "deadbe" };
const NOW = "2026-04-28";

describe("fingerprintFrom", () => {
  it("returns 64-char fullHash + 6-char shortHash", async () => {
    const fp = await fingerprintFrom({ cpu: "i7", mac: "aa:bb:cc:dd:ee:ff" });
    expect(fp.fullHash.length).toBe(64);
    expect(fp.shortHash.length).toBe(6);
    expect(fp.shortHash).toBe(fp.fullHash.slice(0, 6));
  });
  it("deterministic for same inputs", async () => {
    const a = await fingerprintFrom({ cpu: "i7", mac: "aa:bb" });
    const b = await fingerprintFrom({ cpu: "i7", mac: "aa:bb" });
    expect(a.fullHash).toBe(b.fullHash);
  });
  it("different inputs → different hashes", async () => {
    const a = await fingerprintFrom({ cpu: "i7", mac: "aa" });
    const b = await fingerprintFrom({ cpu: "i9", mac: "aa" });
    expect(a.fullHash).not.toBe(b.fullHash);
  });
});

describe("encodeKey + parseKey roundtrip", () => {
  it("roundtrips edition flags + fingerprint + expiry", () => {
    const original = { editionFlags: PRESET_BUNDLES.pro, shopFingerprintShort: "abc123", expiryDate: "2027-04-28" };
    const key = encodeKey(original);
    const parsed = parseKey(key);
    expect(parsed.editionFlags).toBe(original.editionFlags);
    expect(parsed.shopFingerprintShort.toLowerCase()).toBe("abc123");
    expect(parsed.expiryDate).toBe("2027-04-28");
  });

  it("emits PCPR-prefixed 8-group format", () => {
    const k = encodeKey({ editionFlags: 0xff, shopFingerprintShort: "deadbe", expiryDate: "2027-12-31" });
    const groups = k.split("-");
    expect(groups[0]).toBe("PCPR");
    expect(groups[1]).toBe("2027");
    expect(groups.length).toBe(8);
    expect(groups[7]?.length).toBe(4);
  });
});

describe("parseKey error paths", () => {
  it("wrong group count → InvalidLicenseError", () => {
    expect(() => parseKey("PCPR-2027-XXXX")).toThrow(InvalidLicenseError);
  });
  it("wrong product code → error", () => {
    expect(() => parseKey("XXXX-2027-AAAA-AAAA-AAAA-AAAA-AAAA-1234")).toThrow(/product code/);
  });
  it("invalid year → error", () => {
    expect(() => parseKey("PCPR-99-AAAA-AAAA-AAAA-AAAA-AAAA-1234")).toThrow(/year/);
  });
  it("non-hex grid → error", () => {
    expect(() => parseKey("PCPR-2027-ZZZZ-AAAA-AAAA-AAAA-AAAA-1234")).toThrow(/grid/);
  });
  it("bad check digit → error", () => {
    const good = encodeKey({ editionFlags: 1, shopFingerprintShort: "abcdef", expiryDate: "2027-01-01" });
    const tampered = good.slice(0, -4) + "0000";
    expect(() => parseKey(tampered)).toThrow(/check digit/);
  });
});

describe("validateLicense", () => {
  const validKey = encodeKey({ editionFlags: PRESET_BUNDLES.pro, shopFingerprintShort: TEST_FP.shortHash, expiryDate: "2027-04-28" });

  it("valid + matching fingerprint → valid", () => {
    const r = validateLicense({ licenseKey: validKey, shopFingerprint: TEST_FP, nowIso: NOW });
    expect(r.valid).toBe(true);
    expect(r.daysToExpiry).toBeGreaterThan(360);
  });

  it("hasFlag returns true for unlocked features", () => {
    const r = validateLicense({ licenseKey: validKey, shopFingerprint: TEST_FP, nowIso: NOW });
    expect(r.hasFlag("CORE_BILLING")).toBe(true);
    expect(r.hasFlag("AI_COPILOT")).toBe(true);
    expect(r.hasFlag("MULTI_STORE")).toBe(false);            // pro doesn't include multi-store
  });

  it("expired license → invalid", () => {
    const expired = encodeKey({ editionFlags: 1, shopFingerprintShort: TEST_FP.shortHash, expiryDate: "2025-01-01" });
    const r = validateLicense({ licenseKey: expired, shopFingerprint: TEST_FP, nowIso: NOW });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("expired");
  });

  it("fingerprint mismatch outside grace → invalid", () => {
    const wrongFp = { fullHash: "11".repeat(32), shortHash: "111111" };
    const expiredKey = encodeKey({ editionFlags: 1, shopFingerprintShort: TEST_FP.shortHash, expiryDate: "2024-01-01" });
    const r = validateLicense({ licenseKey: expiredKey, shopFingerprint: wrongFp, nowIso: NOW });
    expect(r.valid).toBe(false);
  });

  it("fingerprint mismatch within grace → valid + inGrace", () => {
    // license expires soon, hardware changed, but within 60-day grace
    const wrongFp = { fullHash: "11".repeat(32), shortHash: "111111" };
    const r = validateLicense({ licenseKey: validKey, shopFingerprint: wrongFp, nowIso: NOW });
    expect(r.valid).toBe(true);
    expect(r.inGrace).toBe(true);
  });

  it("garbage license → invalid + reason", () => {
    const r = validateLicense({ licenseKey: "garbage", shopFingerprint: TEST_FP });
    expect(r.valid).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe("issueLicense", () => {
  it("issues a starter license valid for 365d", () => {
    const k = issueLicense({ preset: "starter", shopFingerprintShort: "abc123", validForDays: 365, issueDate: "2026-04-28" });
    expect(k.raw).toMatch(/^PCPR-2027-/);                   // expiry year
    const parsed = parseKey(k.raw);
    expect(parsed.expiryDate).toBe("2027-04-28");
  });

  it("preset bundles map to specific flags", () => {
    const free = issueLicense({ preset: "free", shopFingerprintShort: "abc123", validForDays: 30 });
    const proKey = issueLicense({ preset: "pro", shopFingerprintShort: "abc123", validForDays: 365 });
    const ent  = issueLicense({ preset: "enterprise", shopFingerprintShort: "abc123", validForDays: 365 });
    expect(free.parts.editionFlags & EDITION_FLAGS.TRIAL).toBeTruthy();
    expect(proKey.parts.editionFlags & EDITION_FLAGS.AI_COPILOT).toBeTruthy();
    expect(ent.parts.editionFlags & EDITION_FLAGS.MULTI_STORE).toBeTruthy();
    expect(ent.parts.editionFlags & EDITION_FLAGS.ENTERPRISE).toBeTruthy();
  });

  it("custom flags override preset", () => {
    const k = issueLicense({
      preset: "starter",
      customFlags: EDITION_FLAGS.CORE_BILLING | EDITION_FLAGS.AI_COPILOT | EDITION_FLAGS.MULTI_STORE,
      shopFingerprintShort: "abc123", validForDays: 90,
    });
    expect(k.parts.editionFlags & EDITION_FLAGS.AI_COPILOT).toBeTruthy();
    expect(k.parts.editionFlags & EDITION_FLAGS.MULTI_STORE).toBeTruthy();
    expect(k.parts.editionFlags & EDITION_FLAGS.CORE_INVENTORY).toBeFalsy();
  });
});

describe("trialStateFrom", () => {
  it("free preset yields trial=true", () => {
    const k = issueLicense({ preset: "free", shopFingerprintShort: TEST_FP.shortHash, validForDays: 30, issueDate: NOW });
    const r = validateLicense({ licenseKey: k.raw, shopFingerprint: TEST_FP, nowIso: NOW });
    const t = trialStateFrom(r);
    expect(t.isTrial).toBe(true);
    expect(t.daysRemaining).toBeGreaterThanOrEqual(29);
    expect(t.featuresUnlocked).toContain("CORE_BILLING");
  });
  it("pro license is not trial", () => {
    const k = issueLicense({ preset: "pro", shopFingerprintShort: TEST_FP.shortHash, validForDays: 365, issueDate: NOW });
    const r = validateLicense({ licenseKey: k.raw, shopFingerprint: TEST_FP, nowIso: NOW });
    expect(trialStateFrom(r).isTrial).toBe(false);
  });
});
