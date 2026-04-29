import { describe, it, expect } from "vitest";
import {
  isAfterHours,
  detectHighDiscount, detectAfterHours, detectFrequentVoids,
  detectDuplicateRefunds, detectSchedXVelocity, detectAnomalies,
  DEFAULT_THRESHOLDS,
  type BillFeature, type RefundFeature, type ShopHours,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

const HOURS: ShopHours = { openTime: "09:00", closeTime: "21:00" };

const mkBill = (overrides: Partial<BillFeature> = {}): BillFeature => ({
  billId: `b-${Math.random()}`, billNo: "B1",
  userId: "u_cashier",
  billedAt: "2026-04-28T12:00:00Z",
  grandTotalPaise: paise(10000),
  discountPaise: paise(0),
  subtotalPaise: paise(10000),
  voided: false,
  schedXLineCount: 0,
  ...overrides,
});

const mkRefund = (overrides: Partial<RefundFeature> = {}): RefundFeature => ({
  returnId: `r-${Math.random()}`, originalBillId: "b1",
  userId: "u_cashier", refundedAt: "2026-04-28T13:00:00Z",
  refundPaise: paise(1000),
  ...overrides,
});

describe("isAfterHours", () => {
  it("true for 5am bill", () => {
    expect(isAfterHours("2026-04-28T05:00:00Z", HOURS)).toBe(true);
  });
  it("true for 23:30 bill", () => {
    expect(isAfterHours("2026-04-28T23:30:00Z", HOURS)).toBe(true);
  });
  it("false for noon bill", () => {
    expect(isAfterHours("2026-04-28T12:00:00Z", HOURS)).toBe(false);
  });
});

describe("detectHighDiscount", () => {
  it("flags user with avg discount > threshold across enough bills", () => {
    const bills = Array.from({ length: 15 }, () =>
      mkBill({ subtotalPaise: paise(10000), discountPaise: paise(1500) }));   // 15% discount
    const r = detectHighDiscount(bills);
    expect(r).toHaveLength(1);
    expect(r[0]?.category).toBe("high-discount-rate");
    expect(r[0]?.score).toBeGreaterThan(0);
    expect(r[0]?.evidenceBillIds.length).toBeLessThanOrEqual(5);
  });

  it("does not flag if too few bills (low confidence)", () => {
    const bills = Array.from({ length: 5 }, () =>
      mkBill({ discountPaise: paise(2000) }));
    expect(detectHighDiscount(bills)).toHaveLength(0);
  });

  it("does not flag if avg below threshold", () => {
    const bills = Array.from({ length: 15 }, () =>
      mkBill({ discountPaise: paise(500) }));   // 5%
    expect(detectHighDiscount(bills)).toHaveLength(0);
  });

  it("separates per user", () => {
    const bills = [
      ...Array.from({ length: 12 }, (_, i) => mkBill({ userId: "u1", discountPaise: paise(2000) })),
      ...Array.from({ length: 12 }, (_, i) => mkBill({ userId: "u2", discountPaise: paise(100) })),
    ];
    const r = detectHighDiscount(bills);
    expect(r).toHaveLength(1);
    expect(r[0]?.userId).toBe("u1");
  });
});

describe("detectAfterHours", () => {
  it("flags user with after-hours bill", () => {
    const bills = [mkBill({ billedAt: "2026-04-28T05:00:00Z" })];
    const r = detectAfterHours(bills, HOURS);
    expect(r).toHaveLength(1);
    expect(r[0]?.category).toBe("after-hours");
  });

  it("ignores in-hours bills", () => {
    const bills = [mkBill(), mkBill({ billedAt: "2026-04-28T16:00:00Z" })];
    expect(detectAfterHours(bills, HOURS)).toHaveLength(0);
  });

  it("aggregates per user", () => {
    const bills = [
      mkBill({ userId: "u1", billedAt: "2026-04-28T05:00:00Z" }),
      mkBill({ userId: "u1", billedAt: "2026-04-28T23:00:00Z" }),
      mkBill({ userId: "u2", billedAt: "2026-04-28T22:30:00Z" }),
    ];
    const r = detectAfterHours(bills, HOURS);
    expect(r).toHaveLength(2);
  });
});

describe("detectFrequentVoids", () => {
  it("flags > N voids by single user", () => {
    const bills = [
      mkBill({ voided: true }), mkBill({ voided: true }), mkBill({ voided: true }), mkBill({ voided: true }),
    ];
    expect(detectFrequentVoids(bills)).toHaveLength(1);
  });
  it("ignores below threshold", () => {
    const bills = [mkBill({ voided: true }), mkBill({ voided: true })];
    expect(detectFrequentVoids(bills)).toHaveLength(0);
  });
});

describe("detectDuplicateRefunds", () => {
  it("flags same bill refunded twice", () => {
    const refunds = [
      mkRefund({ originalBillId: "b1" }),
      mkRefund({ originalBillId: "b1" }),
    ];
    expect(detectDuplicateRefunds(refunds)).toHaveLength(1);
  });
  it("does not flag distinct bill refunds", () => {
    const refunds = [
      mkRefund({ originalBillId: "b1" }),
      mkRefund({ originalBillId: "b2" }),
    ];
    expect(detectDuplicateRefunds(refunds)).toHaveLength(0);
  });
});

describe("detectSchedXVelocity", () => {
  it("flags user with > N Schedule X dispenses in window", () => {
    const bills = Array.from({ length: 8 }, () => mkBill({ schedXLineCount: 1 }));
    expect(detectSchedXVelocity(bills)).toHaveLength(1);
  });
  it("ignores when below threshold", () => {
    const bills = Array.from({ length: 3 }, () => mkBill({ schedXLineCount: 1 }));
    expect(detectSchedXVelocity(bills)).toHaveLength(0);
  });
});

describe("detectAnomalies — orchestrator", () => {
  it("returns alerts with shop_id stamped + stable id", () => {
    const bills = [mkBill({ billedAt: "2026-04-28T05:00:00Z", userId: "u_x" })];
    const r = detectAnomalies({ shopId: "shop_local", bills, refunds: [], hours: HOURS });
    expect(r).toHaveLength(1);
    expect(r[0]?.shopId).toBe("shop_local");
    expect(r[0]?.id).toMatch(/^fa_after-hours_u_x_/);
  });
  it("aggregates multiple categories at once", () => {
    const bills = [
      ...Array.from({ length: 12 }, () => mkBill({ userId: "u1", discountPaise: paise(2000) })),
      mkBill({ userId: "u1", billedAt: "2026-04-28T05:00:00Z" }),
    ];
    const r = detectAnomalies({ shopId: "shop_local", bills, refunds: [], hours: HOURS });
    expect(r.length).toBeGreaterThanOrEqual(2);
  });
});
