import { describe, it, expect } from "vitest";
import {
  parseSemver, compareSemver, isNewerThan, channelMatches,
  checkForUpdate, validateManifest,
  InvalidSemverError, InvalidManifestError,
  type UpdateManifest, type ReleaseEntry,
} from "./index.js";

describe("parseSemver", () => {
  it("parses standard 3-part", () => {
    expect(parseSemver("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });
  it("parses pre-release", () => {
    expect(parseSemver("1.0.0-beta.1")).toMatchObject({ major: 1, minor: 0, patch: 0, preRelease: "beta.1" });
  });
  it("rejects garbage", () => { expect(() => parseSemver("garbage")).toThrow(InvalidSemverError); });
  it("rejects v-prefix", () => { expect(() => parseSemver("v1.2.3")).toThrow(InvalidSemverError); });
});

describe("compareSemver", () => {
  it("major version diff", () => { expect(compareSemver("2.0.0", "1.99.99")).toBe(1); });
  it("minor diff when major equal", () => { expect(compareSemver("1.2.0", "1.1.99")).toBe(1); });
  it("patch diff when major+minor equal", () => { expect(compareSemver("1.2.4", "1.2.3")).toBe(1); });
  it("equality", () => { expect(compareSemver("1.2.3", "1.2.3")).toBe(0); });
  it("pre-release < release (semver spec)", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-alpha")).toBe(1);
  });
  it("pre-release alphabetical ordering", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });
});

describe("isNewerThan", () => {
  it("newer", () => { expect(isNewerThan("2.0.0", "1.0.0")).toBe(true); });
  it("equal", () => { expect(isNewerThan("1.0.0", "1.0.0")).toBe(false); });
  it("older", () => { expect(isNewerThan("0.9.0", "1.0.0")).toBe(false); });
});

describe("channelMatches", () => {
  it("stable user only sees stable", () => {
    expect(channelMatches("stable", "stable")).toBe(true);
    expect(channelMatches("beta", "stable")).toBe(false);
    expect(channelMatches("nightly", "stable")).toBe(false);
  });
  it("beta user sees stable + beta", () => {
    expect(channelMatches("stable", "beta")).toBe(true);
    expect(channelMatches("beta", "beta")).toBe(true);
    expect(channelMatches("nightly", "beta")).toBe(false);
  });
  it("nightly user sees everything", () => {
    expect(channelMatches("stable", "nightly")).toBe(true);
    expect(channelMatches("beta", "nightly")).toBe(true);
    expect(channelMatches("nightly", "nightly")).toBe(true);
  });
});

describe("checkForUpdate", () => {
  const mkRelease = (overrides: Partial<ReleaseEntry>): ReleaseEntry => ({
    version: "1.0.0", channel: "stable", publishedAt: "2026-04-01",
    notes: "Initial release",
    assets: [{
      platform: "windows-x86_64", url: "https://x/y.msi",
      sha256: "deadbeef".repeat(8), sizeBytes: 100_000_000, signature: "sig",
    }],
    ...overrides,
  });

  const mkManifest = (rs: readonly ReleaseEntry[]): UpdateManifest => ({
    product: "PharmaCare",
    latest: { stable: "1.0.0", beta: "1.0.0", nightly: "1.0.0" },
    releases: rs, generatedAt: "2026-04-28",
  });

  it("returns hasUpdate=false when on latest", () => {
    const m = mkManifest([mkRelease({ version: "1.0.0" })]);
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "windows-x86_64", channel: "stable", manifest: m });
    expect(r.hasUpdate).toBe(false);
  });

  it("returns target when newer release available", () => {
    const m = mkManifest([
      mkRelease({ version: "1.0.0" }),
      mkRelease({ version: "1.1.0", notes: "Bug fixes" }),
    ]);
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "windows-x86_64", channel: "stable", manifest: m });
    expect(r.hasUpdate).toBe(true);
    if (r.hasUpdate) {
      expect(r.target).toBe("1.1.0");
      expect(r.notes).toContain("Bug fixes");
    }
  });

  it("picks newest among multiple newer", () => {
    const m = mkManifest([
      mkRelease({ version: "1.1.0" }),
      mkRelease({ version: "1.2.0" }),
      mkRelease({ version: "1.1.5" }),
    ]);
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "windows-x86_64", channel: "stable", manifest: m });
    if (r.hasUpdate) expect(r.target).toBe("1.2.0");
  });

  it("stable user does not see beta release", () => {
    const m = mkManifest([
      mkRelease({ version: "1.0.0" }),
      mkRelease({ version: "2.0.0-beta.1", channel: "beta" }),
    ]);
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "windows-x86_64", channel: "stable", manifest: m });
    expect(r.hasUpdate).toBe(false);
  });

  it("beta user sees the beta", () => {
    const m = mkManifest([
      mkRelease({ version: "1.0.0" }),
      mkRelease({ version: "2.0.0-beta.1", channel: "beta" }),
    ]);
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "windows-x86_64", channel: "beta", manifest: m });
    if (r.hasUpdate) expect(r.target).toBe("2.0.0-beta.1");
  });

  it("missing platform → no update for that platform", () => {
    const m = mkManifest([mkRelease({ version: "1.1.0" })]);    // only windows-x86_64
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "linux-x86_64", channel: "stable", manifest: m });
    expect(r.hasUpdate).toBe(false);
  });

  it("mandatory flag bubbles up", () => {
    const m = mkManifest([mkRelease({ version: "1.1.0", mandatory: true })]);
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "windows-x86_64", channel: "stable", manifest: m });
    if (r.hasUpdate) expect(r.mandatory).toBe(true);
  });

  it("minSupportedVersion forces mandatory when current is below", () => {
    const m = mkManifest([mkRelease({ version: "2.0.0", minSupportedVersion: "1.5.0" })]);
    const r = checkForUpdate({ currentVersion: "1.0.0", platform: "windows-x86_64", channel: "stable", manifest: m });
    if (r.hasUpdate) expect(r.mandatory).toBe(true);
  });
});

describe("validateManifest", () => {
  it("accepts well-formed manifest", () => {
    const m = {
      product: "PharmaCare", latest: { stable: "1.0.0", beta: "1.0.0", nightly: "1.0.0" },
      releases: [{
        version: "1.0.0", channel: "stable", publishedAt: "2026-04-01", notes: "",
        assets: [{ platform: "windows-x86_64", url: "x", sha256: "a", sizeBytes: 1, signature: "s" }],
      }],
      generatedAt: "2026-04-28",
    };
    expect(() => validateManifest(m)).not.toThrow();
  });

  it("rejects wrong product", () => {
    expect(() => validateManifest({ product: "Marg" })).toThrow(InvalidManifestError);
  });

  it("rejects bad semver in release", () => {
    expect(() => validateManifest({
      product: "PharmaCare", latest: {}, releases: [
        { version: "garbage", channel: "stable", assets: [] },
      ],
    })).toThrow();
  });

  it("rejects bad channel", () => {
    expect(() => validateManifest({
      product: "PharmaCare", latest: {}, releases: [
        { version: "1.0.0", channel: "alpha", assets: [] },
      ],
    })).toThrow(/channel/);
  });
});
