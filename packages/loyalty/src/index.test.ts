import { describe, it, expect } from "vitest";
import {
  tierForSpend, DEFAULT_TIERS,
  applicableCampaigns,
  computeLoyaltyDiscount, cashbackBalance,
  type Campaign, type CashbackEntry,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

describe("tierForSpend", () => {
  it("zero spend → bronze", () => {
    expect(tierForSpend(paise(0)).tier).toBe("bronze");
  });
  it("₹3000 → silver (≥₹2500)", () => {
    expect(tierForSpend(paise(300000)).tier).toBe("silver");
  });
  it("₹10000 → gold (boundary)", () => {
    expect(tierForSpend(paise(1000000)).tier).toBe("gold");
  });
  it("₹50000 → platinum", () => {
    expect(tierForSpend(paise(5000000)).tier).toBe("platinum");
  });
  it("₹49999 → gold (just below platinum threshold)", () => {
    expect(tierForSpend(paise(4999999)).tier).toBe("gold");
  });
});

describe("applicableCampaigns", () => {
  const today = "2026-04-28T12:00:00Z";

  it("birthday match", () => {
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "BDay", trigger: { kind: "birthday" },
      bonusPaise: paise(50000),
      validFrom: "2026-01-01", validTo: "2026-12-31", active: true,
    }];
    const r = applicableCampaigns(c, { nowIso: today, customerBirthDateIso: "1990-04-28" });
    expect(r).toHaveLength(1);
  });

  it("birthday miss (different day)", () => {
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "BDay", trigger: { kind: "birthday" },
      validFrom: "2026-01-01", validTo: "2026-12-31", active: true,
    }];
    const r = applicableCampaigns(c, { nowIso: today, customerBirthDateIso: "1990-05-15" });
    expect(r).toHaveLength(0);
  });

  it("drugClass match", () => {
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "CardioPlus", trigger: { kind: "drugClass", atc: "C09" },
      discountPct: 5,
      validFrom: "2026-01-01", validTo: "2026-12-31", active: true,
    }];
    const r = applicableCampaigns(c, { nowIso: today, basketAtcClasses: ["C09", "N02"] });
    expect(r).toHaveLength(1);
  });

  it("inactive campaign skipped", () => {
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "Manual", trigger: { kind: "manual" },
      validFrom: "2026-01-01", validTo: "2026-12-31", active: false,
    }];
    const r = applicableCampaigns(c, { nowIso: today });
    expect(r).toHaveLength(0);
  });

  it("expired campaign skipped", () => {
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "Manual", trigger: { kind: "manual" },
      validFrom: "2025-01-01", validTo: "2025-12-31", active: true,
    }];
    const r = applicableCampaigns(c, { nowIso: today });
    expect(r).toHaveLength(0);
  });

  it("future campaign not yet active", () => {
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "Manual", trigger: { kind: "manual" },
      validFrom: "2027-01-01", validTo: "2027-12-31", active: true,
    }];
    const r = applicableCampaigns(c, { nowIso: today });
    expect(r).toHaveLength(0);
  });
});

describe("computeLoyaltyDiscount", () => {
  it("bronze + no campaigns = no discount", () => {
    const r = computeLoyaltyDiscount({
      tier: DEFAULT_TIERS[0]!,
      campaigns: [],
      subtotalPaise: paise(100000),
    });
    expect(r.totalDiscountPaise).toBe(paise(0));
  });

  it("silver tier 1% on ₹1000 → ₹10 (1000 paise)", () => {
    const silver = DEFAULT_TIERS[1]!;
    const r = computeLoyaltyDiscount({
      tier: silver, campaigns: [], subtotalPaise: paise(100000),
    });
    expect(r.totalDiscountPaise).toBe(paise(1000));
  });

  it("stacks tier + campaign discounts", () => {
    const gold = DEFAULT_TIERS[2]!;
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "BDayDiscount", trigger: { kind: "manual" },
      discountPct: 3,
      validFrom: "2026-01-01", validTo: "2026-12-31", active: true,
    }];
    const r = computeLoyaltyDiscount({ tier: gold, campaigns: c, subtotalPaise: paise(100000) });
    // 2% + 3% = 5% of 1000 paise = 5000 paise total
    expect(r.totalDiscountPaise).toBe(paise(5000));
  });

  it("caps total discount at subtotal", () => {
    const gold = DEFAULT_TIERS[2]!;
    const huge: Campaign[] = [{
      id: "c1", shopId: "s", name: "Insane", trigger: { kind: "manual" },
      discountPct: 200,
      validFrom: "2026-01-01", validTo: "2026-12-31", active: true,
    }];
    const r = computeLoyaltyDiscount({ tier: gold, campaigns: huge, subtotalPaise: paise(100000) });
    expect(r.totalDiscountPaise).toBe(paise(100000));     // capped at subtotal
  });

  it("accumulates campaign cashback bonus separately", () => {
    const bronze = DEFAULT_TIERS[0]!;
    const c: Campaign[] = [{
      id: "c1", shopId: "s", name: "Bonus", trigger: { kind: "manual" },
      bonusPaise: paise(10000),
      validFrom: "2026-01-01", validTo: "2026-12-31", active: true,
    }];
    const r = computeLoyaltyDiscount({ tier: bronze, campaigns: c, subtotalPaise: paise(100000) });
    expect(r.bonusPaise).toBe(paise(10000));
    expect(r.totalDiscountPaise).toBe(paise(0));
  });
});

describe("cashbackBalance", () => {
  it("zero entries → 0", () => {
    expect(cashbackBalance([])).toBe(paise(0));
  });
  it("earn + redeem", () => {
    const entries: CashbackEntry[] = [
      { id: "1", customerId: "c", deltaPaise: paise(10000), reason: "purchase 5%", createdAt: "" },
      { id: "2", customerId: "c", deltaPaise: paise(-3000), reason: "redeem", createdAt: "" },
    ];
    expect(cashbackBalance(entries)).toBe(paise(7000));
  });
  it("never goes negative", () => {
    const entries: CashbackEntry[] = [
      { id: "1", customerId: "c", deltaPaise: paise(-10000), reason: "phantom redeem", createdAt: "" },
    ];
    expect(cashbackBalance(entries)).toBe(paise(0));
  });
});
