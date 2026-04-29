import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ageInDays, computeAging, ZERO_AGING, heuristicRiskScore,
  recordCreditPurchase, recordPayment, ageingForCustomer,
  CreditLimitExceededError, InvalidEntryError,
  type KhataEntry, type KhataRepo, type CustomerCreditLimit,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

const NOW = new Date("2026-04-28T12:00:00Z");
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

describe("ageInDays", () => {
  it("0 for entry created now", () => {
    expect(ageInDays(NOW.toISOString(), NOW)).toBe(0);
  });
  it("integer days back", () => {
    expect(ageInDays(daysAgo(15), NOW)).toBe(15);
  });
  it("never negative even for future-dated rows", () => {
    const future = new Date(NOW.getTime() + 24 * 3600_000).toISOString();
    expect(ageInDays(future, NOW)).toBe(0);
  });
  it("invalid date string → 0", () => {
    expect(ageInDays("not a date", NOW)).toBe(0);
  });
});

describe("computeAging — bucket boundaries", () => {
  const mk = (createdAt: string, debit: number, credit = 0): KhataEntry => ({
    id: `e-${createdAt}-${debit}-${credit}`,
    customerId: "c1",
    debitPaise: paise(debit),
    creditPaise: paise(credit),
    createdAt,
    recordedByUserId: "u_owner",
  });

  it("zero entries → ZERO_AGING", () => {
    const a = computeAging("c1", [], NOW);
    expect(a).toEqual(ZERO_AGING("c1"));
  });

  it("debit 5 days old → current bucket only", () => {
    const a = computeAging("c1", [mk(daysAgo(5), 100000)], NOW);
    expect(a.current).toBe(paise(100000));
    expect(a.thirty).toBe(paise(0));
    expect(a.totalDuePaise).toBe(paise(100000));
  });

  it("debit 31 days old → thirty bucket", () => {
    const a = computeAging("c1", [mk(daysAgo(31), 50000)], NOW);
    expect(a.current).toBe(paise(0));
    expect(a.thirty).toBe(paise(50000));
  });

  it("debit 95 days old → ninetyPlus bucket + oldestDueDate set", () => {
    const ts = daysAgo(95);
    const a = computeAging("c1", [mk(ts, 80000)], NOW);
    expect(a.ninetyPlus).toBe(paise(80000));
    expect(a.oldestDueDate).toBe(ts);
  });

  it("payment FIFO-matches the OLDEST debit first", () => {
    // ₹500 owed 95 days ago + ₹500 owed 5 days ago. Pays ₹500.
    // FIFO match → 95-day debit cleared; the 5-day debit (current) stays.
    const e1 = mk(daysAgo(95), 50000);
    const e2 = mk(daysAgo(5),  50000);
    const pay = mk(daysAgo(1),  0, 50000);
    const a = computeAging("c1", [e1, e2, pay], NOW);
    expect(a.ninetyPlus).toBe(paise(0));
    expect(a.current).toBe(paise(50000));
    expect(a.totalDuePaise).toBe(paise(50000));
  });

  it("partial payment leaves residual in oldest bucket", () => {
    // ₹500 95 days ago + ₹500 5 days ago. Pays ₹200.
    // Match against 95-day → 95-day residual = ₹300; 5-day stays ₹500.
    const a = computeAging("c1", [
      mk(daysAgo(95), 50000),
      mk(daysAgo(5),  50000),
      mk(daysAgo(1),   0, 20000),
    ], NOW);
    expect(a.ninetyPlus).toBe(paise(30000));
    expect(a.current).toBe(paise(50000));
    expect(a.totalDuePaise).toBe(paise(80000));
  });

  it("oldestDueDate is the ISO of the oldest UNPAID debit", () => {
    const ts1 = daysAgo(95);
    const ts2 = daysAgo(50);
    // Pay enough to clear the 95-day debit fully → oldest unpaid is the 50-day one
    const a = computeAging("c1", [
      mk(ts1, 50000),
      mk(ts2, 30000),
      mk(daysAgo(1), 0, 50000),
    ], NOW);
    expect(a.oldestDueDate).toBe(ts2);
  });
});

describe("heuristicRiskScore", () => {
  it("zero balance → score 0", () => {
    const a = ZERO_AGING("c1");
    expect(heuristicRiskScore(a, paise(100000))).toBe(0);
  });
  it("100% utilisation + all 90+ → score 1.0", () => {
    const a = {
      customerId: "c1",
      current: paise(0), thirty: paise(0), sixty: paise(0),
      ninetyPlus: paise(100000), totalDuePaise: paise(100000), oldestDueDate: null,
    };
    expect(heuristicRiskScore(a, paise(100000))).toBe(1);
  });
  it("50% utilisation + half 90+ → 0.5", () => {
    const a = {
      customerId: "c1",
      current: paise(25000), thirty: paise(0), sixty: paise(0),
      ninetyPlus: paise(25000), totalDuePaise: paise(50000), oldestDueDate: null,
    };
    expect(heuristicRiskScore(a, paise(100000))).toBeCloseTo(0.5, 4);
  });
});

describe("recordCreditPurchase + recordPayment", () => {
  function makeRepo(initialLimit?: CustomerCreditLimit, initialEntries: KhataEntry[] = []): KhataRepo & { _entries: KhataEntry[] } {
    let limit = initialLimit;
    const entries: KhataEntry[] = [...initialEntries];
    return {
      _entries: entries,
      async listEntriesForCustomer(cid: string) { return entries.filter((e) => e.customerId === cid); },
      async getCreditLimit(cid: string) {
        if (!limit || limit.customerId !== cid) return null;
        return limit;
      },
      async upsertCreditLimit(c: CustomerCreditLimit) { limit = c; },
      async insertEntry(e: KhataEntry) { entries.push(e); return e; },
    };
  }

  it("records a credit purchase and updates current_due", async () => {
    const repo = makeRepo({
      customerId: "c1", creditLimitPaise: paise(500000),
      currentDuePaise: paise(0), defaultRiskScore: 0, updatedAt: NOW.toISOString(),
    });
    const ids = vi.fn(() => "entry-1");
    await recordCreditPurchase(repo, {
      entryIdGenerator: ids,
      customerId: "c1",
      billId: "B1",
      amountPaise: paise(150000),
      recordedByUserId: "u_owner",
      nowIso: NOW.toISOString(),
    });
    const lim = await repo.getCreditLimit("c1");
    expect(lim?.currentDuePaise).toBe(paise(150000));
    expect(repo._entries).toHaveLength(1);
  });

  it("rejects when credit limit would be exceeded", async () => {
    const repo = makeRepo({
      customerId: "c1", creditLimitPaise: paise(100000),
      currentDuePaise: paise(80000), defaultRiskScore: 0, updatedAt: NOW.toISOString(),
    });
    await expect(recordCreditPurchase(repo, {
      entryIdGenerator: () => "entry-1",
      customerId: "c1",
      billId: "B1",
      amountPaise: paise(30000),    // would push to 110000 > 100000
      recordedByUserId: "u_owner",
    })).rejects.toThrow(CreditLimitExceededError);
  });

  it("rejects zero or negative debit", async () => {
    const repo = makeRepo();
    await expect(recordCreditPurchase(repo, {
      entryIdGenerator: () => "x",
      customerId: "c1",
      billId: "B1",
      amountPaise: paise(0),
      recordedByUserId: "u_owner",
    })).rejects.toThrow(InvalidEntryError);
  });

  it("records a payment and decrements current_due", async () => {
    const repo = makeRepo({
      customerId: "c1", creditLimitPaise: paise(500000),
      currentDuePaise: paise(200000), defaultRiskScore: 0, updatedAt: NOW.toISOString(),
    });
    await recordPayment(repo, {
      entryIdGenerator: () => "p1",
      customerId: "c1",
      amountPaise: paise(80000),
      recordedByUserId: "u_owner",
    });
    const lim = await repo.getCreditLimit("c1");
    expect(lim?.currentDuePaise).toBe(paise(120000));
  });

  it("payment cannot drive currentDue below zero", async () => {
    const repo = makeRepo({
      customerId: "c1", creditLimitPaise: paise(500000),
      currentDuePaise: paise(50000), defaultRiskScore: 0, updatedAt: NOW.toISOString(),
    });
    await recordPayment(repo, {
      entryIdGenerator: () => "p1",
      customerId: "c1",
      amountPaise: paise(80000),     // bigger than the due
      recordedByUserId: "u_owner",
    });
    const lim = await repo.getCreditLimit("c1");
    expect(lim?.currentDuePaise).toBe(paise(0));
  });

  it("ageingForCustomer returns ZERO_AGING when no entries", async () => {
    const repo = makeRepo();
    const a = await ageingForCustomer(repo, "c-nobody");
    expect(a).toEqual(ZERO_AGING("c-nobody"));
  });
});
