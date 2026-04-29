import { describe, it, expect } from "vitest";
import {
  validateManifest, assertCapability, hasAllCapabilities,
  sensitiveSubset, isHostVersionCompatible, SENSITIVE_CAPABILITIES,
  InvalidManifestError, CapabilityDeniedError,
  type PluginManifest, type Capability,
} from "./index.js";

const VALID: PluginManifest = {
  id: "com.acme.lab",
  name: "Acme Lab Integration",
  version: "1.0.0",
  author: "Acme",
  description: "Sync lab orders into PharmaCare",
  capabilities: ["read.bills", "ui.add-tab"],
  entry: "plugin.wasm",
};

describe("validateManifest", () => {
  it("accepts well-formed manifest", () => {
    expect(() => validateManifest(VALID)).not.toThrow();
  });

  it("rejects non-reverse-DNS id", () => {
    expect(() => validateManifest({ ...VALID, id: "acme-lab" })).toThrow(InvalidManifestError);
    expect(() => validateManifest({ ...VALID, id: "ACME.lab" })).toThrow(InvalidManifestError);
  });

  it("rejects non-semver version", () => {
    expect(() => validateManifest({ ...VALID, version: "1.0" })).toThrow(InvalidManifestError);
    expect(() => validateManifest({ ...VALID, version: "v1.0.0" })).toThrow(InvalidManifestError);
  });

  it("accepts pre-release semver", () => {
    expect(() => validateManifest({ ...VALID, version: "1.0.0-beta.1" })).not.toThrow();
  });

  it("rejects empty name / author / description", () => {
    expect(() => validateManifest({ ...VALID, name: "" })).toThrow(InvalidManifestError);
    expect(() => validateManifest({ ...VALID, author: "" })).toThrow(InvalidManifestError);
    expect(() => validateManifest({ ...VALID, description: "short" })).toThrow(InvalidManifestError);
  });

  it("rejects unknown capability", () => {
    expect(() => validateManifest({
      ...VALID, capabilities: ["god.mode" as Capability],
    })).toThrow(InvalidManifestError);
  });

  it("requires ui.add-tab cap for billing-tab mount", () => {
    expect(() => validateManifest({
      ...VALID,
      capabilities: ["read.bills"],
      screens: [{ mountPoint: "billing-tab", component: "BillingHelper", title: "Lab" }],
    })).toThrow(/ui.add-tab/);
  });

  it("accepts screen mount with proper capability", () => {
    expect(() => validateManifest({
      ...VALID,
      capabilities: ["read.bills", "ui.add-tab"],
      screens: [{ mountPoint: "billing-tab", component: "BillingHelper", title: "Lab" }],
    })).not.toThrow();
  });

  it("requires ui.add-shortcut for command-palette mount", () => {
    expect(() => validateManifest({
      ...VALID,
      capabilities: ["read.bills", "ui.add-tab"],
      screens: [{ mountPoint: "command-palette", component: "Cmd", title: "Lab" }],
    })).toThrow(/ui.add-shortcut/);
  });

  it("rejects bad minHostVersion", () => {
    expect(() => validateManifest({ ...VALID, minHostVersion: "v1" })).toThrow(InvalidManifestError);
  });
});

describe("assertCapability + hasAllCapabilities", () => {
  it("assertCapability passes when granted", () => {
    expect(() => assertCapability("com.acme.x", new Set(["read.bills"]), "read.bills")).not.toThrow();
  });

  it("assertCapability throws CapabilityDeniedError when not granted", () => {
    expect(() => assertCapability("com.acme.x", new Set(["read.bills"]), "write.products"))
      .toThrow(CapabilityDeniedError);
  });

  it("hasAllCapabilities", () => {
    expect(hasAllCapabilities(new Set(["read.bills", "ui.add-tab"]), ["read.bills"])).toBe(true);
    expect(hasAllCapabilities(new Set(["read.bills"]), ["read.bills", "write.audit"])).toBe(false);
  });
});

describe("sensitiveSubset", () => {
  it("returns only sensitive capabilities from a request", () => {
    const requested: Capability[] = ["read.bills", "write.audit", "ui.add-tab", "net.outbound.https"];
    const s = sensitiveSubset(requested);
    expect(s).toEqual(["write.audit", "net.outbound.https"]);
  });

  it("empty when nothing sensitive", () => {
    expect(sensitiveSubset(["read.bills", "ui.add-tab"])).toEqual([]);
  });

  it("SENSITIVE_CAPABILITIES is non-empty and contains write/net/fs", () => {
    expect(SENSITIVE_CAPABILITIES.size).toBeGreaterThan(0);
    expect(SENSITIVE_CAPABILITIES.has("write.audit")).toBe(true);
    expect(SENSITIVE_CAPABILITIES.has("net.outbound.https")).toBe(true);
  });
});

describe("isHostVersionCompatible", () => {
  it("undefined min → always compatible", () => {
    expect(isHostVersionCompatible("0.1.0", undefined)).toBe(true);
  });
  it("equal versions → compatible", () => {
    expect(isHostVersionCompatible("1.2.3", "1.2.3")).toBe(true);
  });
  it("host newer → compatible", () => {
    expect(isHostVersionCompatible("1.3.0", "1.2.0")).toBe(true);
    expect(isHostVersionCompatible("2.0.0", "1.99.99")).toBe(true);
  });
  it("host older → incompatible", () => {
    expect(isHostVersionCompatible("0.5.0", "1.0.0")).toBe(false);
    expect(isHostVersionCompatible("1.0.0", "1.0.1")).toBe(false);
  });
  it("invalid versions → false", () => {
    expect(isHostVersionCompatible("garbage", "1.0.0")).toBe(false);
  });
});
