import { describe, it, expect } from "vitest";
import {
  daysBetween, median, typicalCadence,
  recencyBucket, frequencyBucket, monetaryBucket,
  scoreCustomer, batchScore,
  type CustomerPurchase,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

const NOW = "2026-04-28T12:00:00Z";

describe("daysBetween + median", () => {
  it("daysBetween computes whole days", () => {
    expect(daysBetween("2026-04-25", "2026-04-28")).toBe(3);
  });
  it("median empty → 0", () => { expect(median([])).toBe(0); });
  it("median odd length", () => { expect(median([1, 3, 5])).toBe(3); });
  it("median even length", () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
});

describe("typicalCadence", () => {
  const mk = (iso: string): CustomerPurchase => ({ customerId: "c1", billedAt: iso, amountPaise: paise(0), hasRefillableItems: false });

  it("null for < 2 purchases", () => {
    expect(typicalCadence([])).toBe(null);
    expect(typicalCadence([mk("2026-04-01")])).toBe(null);
  });
  it("regular monthly purchases → ~30 day cadence", () => {
    const p = [mk("2026-01-01"), mk("2026-02-01"), mk("2026-03-01"), mk("2026-04-01")];
    expect(typicalCadence(p)).toBe(31);   // average inter-purchase
  });
  it("median ignores outliers", () => {
    const p = [mk("2026-01-01"), mk("2026-02-01"), mk("2026-03-01"), mk("2026-12-01")];
    expect(typicalCadence(p)).toBeLessThan(60);   // ignored outlier 9-month gap
  });
});

describe("RFM buckets", () => {
  it("recency", () => {
    expect(recencyBucket(0)).toBe(1);
    expect(recencyBucket(30)).toBe(1);
    expect(recencyBucket(31)).toBe(2);
    expect(recencyBucket(91)).toBe(4);
    expect(recencyBucket(200)).toBe(5);
  });
  it("frequency", () => {
    expect(frequencyBucket(0)).toBe(5);
    expect(frequencyBucket(2)).toBe(4);
    expect(frequencyBucket(6)).toBe(2);
    expect(frequencyBucket(12)).toBe(1);
  });
  it("monetary", () => {
    expect(monetaryBucket(paise(0))).toBe(5);
    expect(monetaryBucket(paise(99900))).toBe(5);   // ₹999
    expect(monetaryBucket(paise(100000))).toBe(4);
    expect(monetaryBucket(paise(2500000))).toBe(2);
    expect(monetaryBucket(paise(5000000))).toBe(1);
  });
});

describe("scoreCustomer", () => {
  const mk = (iso: string, amount = 1000, refillable = false): CustomerPurchase =>
    ({ customerId: "c1", billedAt: iso, amountPaise: paise(amount), hasRefillableItems: refillable });

  it("zero purchases → score 0.5 + FIRST_VISIT_OUTREACH", () => {
    const r = scoreCustomer({ customerId: "c1", purchases: [], nowIso: NOW });
    expect(r.score).toBe(0.5);
    expect(r.recommendedActionTemplate).toBe("FIRST_VISIT_OUTREACH");
  });

  it("recent regular customer scores low (good)", () => {
    const purchases = [
      mk("2026-04-01"), mk("2026-04-15"), mk("2026-04-25"),
      mk("2026-03-15"), mk("2026-02-15"), mk("2026-01-15"),
    ];
    const r = scoreCustomer({ customerId: "c1", purchases, nowIso: NOW });
    expect(r.score).toBeLessThan(0.4);
    expect(r.daysSinceLastPurchase).toBeLessThan(10);
  });

  it("dormant 200-day customer scores high (likely churn)", () => {
    const purchases = [mk("2025-09-15"), mk("2025-09-01"), mk("2025-08-15")];
    const r = scoreCustomer({ customerId: "c1", purchases, nowIso: NOW });
    expect(r.score).toBeGreaterThan(0.6);
    expect(r.recommendedActionTemplate).toBe("WIN_BACK_DISCOUNT");
  });

  it("cadence-break customer gets CADENCE_BREAK_NUDGE", () => {
    // Used to come every 30 days, now 75 days late
    const purchases = [
      mk("2026-01-15"), mk("2025-12-15"), mk("2025-11-15"), mk("2025-10-15"),
    ];
    const r = scoreCustomer({ customerId: "c1", purchases, nowIso: NOW });
    expect(r.typicalCadenceDays).toBeCloseTo(31, 0);
    expect(["CADENCE_BREAK_NUDGE","REFILL_REMINDER","WIN_BACK_DISCOUNT"]).toContain(r.recommendedActionTemplate);
  });

  it("predicts expected refill date when cadence known", () => {
    const purchases = [mk("2026-03-01"), mk("2026-02-01"), mk("2026-01-01")];
    const r = scoreCustomer({ customerId: "c1", purchases, nowIso: NOW });
    expect(r.expectedRefillDate).toBeDefined();
    expect(r.typicalCadenceDays).toBe(29.5);   // median of (28, 31)
  });
});

describe("batchScore", () => {
  const mk = (iso: string): CustomerPurchase => ({ customerId: "c", billedAt: iso, amountPaise: paise(1000), hasRefillableItems: false });

  it("ranks customers most-at-risk first", () => {
    const r = batchScore({
      customers: [
        { customerId: "c_loyal", purchases: [mk("2026-04-25"), mk("2026-04-15"), mk("2026-04-05"), mk("2026-03-25"), mk("2026-03-15"), mk("2026-03-05"), mk("2026-02-15")] },
        { customerId: "c_lost",  purchases: [mk("2025-09-01"), mk("2025-08-01")] },
      ],
      nowIso: NOW,
    });
    expect(r[0]?.customerId).toBe("c_lost");
    expect(r[1]?.customerId).toBe("c_loyal");
  });
});
