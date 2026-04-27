// Phase-1 scaffold smoke test. Real per-tier tests land in Phase 2-5.
import { describe, expect, it } from "vitest";
import { photoToGrn, TIER_A_ESCALATION_THRESHOLD, TIER_B_ESCALATION_THRESHOLD } from "./index.js";

describe("@pharmacare/photo-grn — Phase-1 scaffold", () => {
  it("photoToGrn returns an empty Tier-A result with requiresOperatorReview=true", async () => {
    const r = await photoToGrn({
      photoPath: "/tmp/probe.jpg",
      photoSha256: "0".repeat(64),
      reportedMime: "image/jpeg",
      shopId: "shop_local",
    });
    expect(r.winningTier).toBe("A");
    expect(r.tiersAttempted).toEqual(["A"]);
    expect(r.requiresOperatorReview).toBe(true);
    expect(r.bill.lines).toEqual([]);
    expect(r.bill.header.confidence).toBe(0);
    expect(r.costPaise).toBe(0);
  });

  it("escalation thresholds match ADR 0024 §4", () => {
    expect(TIER_A_ESCALATION_THRESHOLD).toBe(0.9);
    expect(TIER_B_ESCALATION_THRESHOLD).toBe(0.92);
  });
});
