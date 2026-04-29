import { describe, it, expect } from "vitest";
import {
  classifyVisual, classifyDataMatrix, combineVerdict,
  SCORE_BLOCK_THRESHOLD, SCORE_WARN_THRESHOLD,
} from "./index.js";

describe("classifyVisual", () => {
  it("ok when distance ≤ 0.15 + topK ≥ 0.7", () => {
    expect(classifyVisual({ cosineDistanceToNearest: 0.10, topKConfidence: 0.8 })).toBe("ok");
  });
  it("suspect when distance ≥ 0.40", () => {
    expect(classifyVisual({ cosineDistanceToNearest: 0.50, topKConfidence: 0.5 })).toBe("suspect");
  });
  it("unknown when no distance available", () => {
    expect(classifyVisual({ cosineDistanceToNearest: null, topKConfidence: null })).toBe("unknown");
  });
  it("middle band + low topK → suspect", () => {
    expect(classifyVisual({ cosineDistanceToNearest: 0.25, topKConfidence: 0.5 })).toBe("suspect");
  });
  it("middle band + high topK → ok", () => {
    expect(classifyVisual({ cosineDistanceToNearest: 0.25, topKConfidence: 0.8 })).toBe("ok");
  });
});

describe("classifyDataMatrix", () => {
  it("ok when decoded and registry verifies", () => {
    expect(classifyDataMatrix({
      decoded: { gtin: "01...", batchNo: "B1", expiry: "260101", serial: "S1" },
      registryVerified: true,
    })).toBe("ok");
  });
  it("fail when registry rejects", () => {
    expect(classifyDataMatrix({
      decoded: { gtin: "01...", batchNo: "B1", expiry: "260101", serial: "S1" },
      registryVerified: false,
    })).toBe("fail");
  });
  it("absent when no DataMatrix on pack", () => {
    expect(classifyDataMatrix({ decoded: null, registryVerified: null })).toBe("absent");
  });
  it("absent when offline (verification unknown)", () => {
    expect(classifyDataMatrix({
      decoded: { gtin: "01", batchNo: "b", expiry: "e", serial: "s" },
      registryVerified: null,
    })).toBe("absent");
  });
});

describe("combineVerdict", () => {
  it("both ok → action=ok, score=1.0", () => {
    const v = combineVerdict(
      { decoded: { gtin: "1", batchNo: "b", expiry: "e", serial: "s" }, registryVerified: true },
      { cosineDistanceToNearest: 0.05, topKConfidence: 0.95 },
    );
    expect(v.action).toBe("ok");
    expect(v.tamperShieldScore).toBeCloseTo(1.0, 2);
  });

  it("DataMatrix fail → action=block regardless of vision", () => {
    const v = combineVerdict(
      { decoded: { gtin: "1", batchNo: "b", expiry: "e", serial: "s" }, registryVerified: false },
      { cosineDistanceToNearest: 0.05, topKConfidence: 0.95 },
    );
    expect(v.action).toBe("block");
    expect(v.reason).toContain("DataMatrix did NOT verify");
  });

  it("visual suspect + no matrix → warn (relabeled/repackaged?)", () => {
    const v = combineVerdict(
      { decoded: null, registryVerified: null },
      { cosineDistanceToNearest: 0.5, topKConfidence: 0.5 },
    );
    expect(v.action).toBe("warn");
  });

  it("matrix ok + visual suspect → warn (relabeled?)", () => {
    const v = combineVerdict(
      { decoded: { gtin: "1", batchNo: "b", expiry: "e", serial: "s" }, registryVerified: true },
      { cosineDistanceToNearest: 0.5, topKConfidence: 0.5 },
    );
    expect(v.action).toBe("warn");
  });

  it("both unknown / absent → mid score, falls into warn band", () => {
    const v = combineVerdict(
      { decoded: null, registryVerified: null },
      { cosineDistanceToNearest: null, topKConfidence: null },
    );
    expect(v.tamperShieldScore).toBe(0.5);
    expect(v.action).toBe("warn");
  });

  it("score thresholds are exposed", () => {
    expect(SCORE_BLOCK_THRESHOLD).toBeGreaterThan(0);
    expect(SCORE_WARN_THRESHOLD).toBeGreaterThan(SCORE_BLOCK_THRESHOLD);
    expect(SCORE_WARN_THRESHOLD).toBeLessThan(1);
  });

  it("calibration sanity: clearly genuine pack passes", () => {
    const v = combineVerdict(
      { decoded: { gtin: "1", batchNo: "b", expiry: "e", serial: "s" }, registryVerified: true },
      { cosineDistanceToNearest: 0.05, topKConfidence: 0.99 },
    );
    expect(v.tamperShieldScore).toBeGreaterThan(0.9);
    expect(v.action).toBe("ok");
  });

  it("calibration sanity: counterfeit fails through fail path", () => {
    const v = combineVerdict(
      { decoded: { gtin: "1", batchNo: "b", expiry: "e", serial: "s" }, registryVerified: false },
      { cosineDistanceToNearest: 0.45, topKConfidence: 0.6 },
    );
    expect(v.action).toBe("block");
  });
});
