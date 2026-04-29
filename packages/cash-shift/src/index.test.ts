import { describe, it, expect, vi } from "vitest";
import {
  totalFromDenominations,
  ZERO_DENOMINATIONS,
  reconcileDenominationsAgainstTotal,
  computeVariance,
  VARIANCE_APPROVAL_THRESHOLD_PAISE,
  buildZReport, sumTenders, EMPTY_TENDER,
  openShift, closeShift,
  assertCanOpenShift, assertCanCloseShift,
  InvalidDenominationCountError,
  ShiftAlreadyOpenError,
  ShiftNotOpenError,
  VarianceRequiresApprovalError,
  type CashShift, type CashShiftRepo, type DenominationCount,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

describe("totalFromDenominations — exact math", () => {
  it("zero denominations → 0 paise", () => {
    expect(totalFromDenominations(ZERO_DENOMINATIONS)).toBe(paise(0));
  });

  it("1 × ₹2000 = 200000 paise", () => {
    const d: DenominationCount = { ...ZERO_DENOMINATIONS, d2000: 1 };
    expect(totalFromDenominations(d)).toBe(paise(200000));
  });

  it("realistic morning float — 4×500 + 10×100 + 20×50 + 30×10 = ₹4300", () => {
    const d: DenominationCount = { ...ZERO_DENOMINATIONS, d500: 4, d100: 10, d50: 20, d10: 30 };
    expect(totalFromDenominations(d)).toBe(paise(430000));
  });

  it("rejects negative count with InvalidDenominationCountError", () => {
    const d: DenominationCount = { ...ZERO_DENOMINATIONS, d500: -1 };
    expect(() => totalFromDenominations(d)).toThrow(InvalidDenominationCountError);
  });

  it("rejects fractional count (bills are physical objects)", () => {
    const d: DenominationCount = { ...ZERO_DENOMINATIONS, d100: 1.5 };
    expect(() => totalFromDenominations(d)).toThrow(InvalidDenominationCountError);
  });
});

describe("reconcileDenominationsAgainstTotal", () => {
  it("matches when count adds up", () => {
    const d: DenominationCount = { ...ZERO_DENOMINATIONS, d500: 2 };
    const r = reconcileDenominationsAgainstTotal(d, paise(100000));
    expect(r.ok).toBe(true);
    expect(r.deltaPaise).toBe(paise(0));
  });

  it("flags mismatch with delta", () => {
    const d: DenominationCount = { ...ZERO_DENOMINATIONS, d500: 2 }; // 1000 rupees
    const r = reconcileDenominationsAgainstTotal(d, paise(95000));   // expected 950 rupees
    expect(r.ok).toBe(false);
    expect(r.deltaPaise).toBe(paise(5000));                          // overage 50 rupees
  });
});

describe("computeVariance — the actual day-close math", () => {
  it("exact match → category=exact, no approval needed", () => {
    const v = computeVariance({
      openingBalancePaise: paise(500000),
      cashSalesPaise:      paise(1500000),
      cashReturnsPaise:    paise(0),
      cashRefundsPaise:    paise(0),
      bankDepositsPaise:   paise(1000000),
      closingActualPaise:  paise(1000000),
    });
    expect(v.expectedClosingPaise).toBe(paise(1000000));
    expect(v.variancePaise).toBe(paise(0));
    expect(v.requiresManagerApproval).toBe(false);
    expect(v.category).toBe("exact");
  });

  it("₹50 paise overage is noise — exact category", () => {
    const v = computeVariance({
      openingBalancePaise: paise(0),
      cashSalesPaise:      paise(100000),
      cashReturnsPaise:    paise(0),
      cashRefundsPaise:    paise(0),
      bankDepositsPaise:   paise(0),
      closingActualPaise:  paise(100050),
    });
    expect(v.absVariancePaise).toBe(paise(50));
    expect(v.category).toBe("exact");                       // <= 50 paise = noise
    expect(v.requiresManagerApproval).toBe(false);
  });

  it("₹100 overage → category=overage, no approval needed (under threshold)", () => {
    const v = computeVariance({
      openingBalancePaise: paise(0),
      cashSalesPaise:      paise(100000),
      cashReturnsPaise:    paise(0),
      cashRefundsPaise:    paise(0),
      bankDepositsPaise:   paise(0),
      closingActualPaise:  paise(100100),    // overage ₹1
    });
    expect(v.variancePaise).toBe(paise(100));
    expect(v.category).toBe("overage");
    expect(v.requiresManagerApproval).toBe(false);
  });

  it("₹501 shortage → category=shortage, manager approval required", () => {
    const v = computeVariance({
      openingBalancePaise: paise(0),
      cashSalesPaise:      paise(100000),
      cashReturnsPaise:    paise(0),
      cashRefundsPaise:    paise(0),
      bankDepositsPaise:   paise(0),
      closingActualPaise:  paise(49900),     // shortage ₹501
    });
    expect(v.variancePaise).toBe(paise(-50100));
    expect(v.category).toBe("shortage");
    expect(v.requiresManagerApproval).toBe(true);
  });

  it("threshold value (₹500.01 = 50001p) requires approval", () => {
    const v = computeVariance({
      openingBalancePaise: paise(0),
      cashSalesPaise:      paise(100000),
      cashReturnsPaise:    paise(0),
      cashRefundsPaise:    paise(0),
      bankDepositsPaise:   paise(0),
      closingActualPaise:  paise(100000 + 50001),
    });
    expect(v.absVariancePaise).toBe(paise(50001));
    expect(v.requiresManagerApproval).toBe(true);
  });

  it("exactly threshold (₹500.00 = 50000p) does NOT require approval", () => {
    const v = computeVariance({
      openingBalancePaise: paise(0),
      cashSalesPaise:      paise(100000),
      cashReturnsPaise:    paise(0),
      cashRefundsPaise:    paise(0),
      bankDepositsPaise:   paise(0),
      closingActualPaise:  paise(100000 + 50000),
    });
    expect(v.absVariancePaise).toBe(VARIANCE_APPROVAL_THRESHOLD_PAISE);
    expect(v.requiresManagerApproval).toBe(false);     // > threshold, not >=
  });
});

describe("Z-report sum + tender breakdown", () => {
  it("sumTenders adds all 5 modes", () => {
    expect(sumTenders({
      cash: paise(100), upi: paise(200), card: paise(300),
      cheque: paise(400), credit: paise(500),
    })).toBe(paise(1500));
  });

  it("buildZReport faithfully copies inputs", () => {
    const z = buildZReport({
      shiftId: "shift-1",
      shopId: "shop_local",
      periodStart: "2026-04-28T10:00:00Z",
      periodEnd: "2026-04-28T22:00:00Z",
      billCount: 47,
      returnCount: 2,
      totalSalesPaise: paise(2500000),
      totalReturnsPaise: paise(50000),
      totalDiscountsPaise: paise(20000),
      gstByHsn: { "3003": paise(120000), "3004": paise(80000) },
      tenderBreakdown: { ...EMPTY_TENDER, cash: paise(800000), upi: paise(1700000) },
    });
    expect(z.billCount).toBe(47);
    expect(sumTenders(z.tenderBreakdown)).toBe(paise(2500000));
  });
});

describe("state machine assertions", () => {
  it("assertCanOpenShift throws if a shift is already open", () => {
    const open: CashShift = {
      id: "s1", shopId: "shop_local", openedByUserId: "u1", openedAt: "now",
      openingBalancePaise: paise(0), openingDenominations: ZERO_DENOMINATIONS,
    };
    expect(() => assertCanOpenShift(open)).toThrow(ShiftAlreadyOpenError);
  });

  it("assertCanOpenShift OK when no shift open", () => {
    expect(() => assertCanOpenShift(null)).not.toThrow();
  });

  it("assertCanOpenShift OK when previous shift was closed", () => {
    const closed: CashShift = {
      id: "s1", shopId: "shop_local", openedByUserId: "u1", openedAt: "open",
      openingBalancePaise: paise(0), openingDenominations: ZERO_DENOMINATIONS,
      closedAt: "close",
    };
    expect(() => assertCanOpenShift(closed)).not.toThrow();
  });

  it("assertCanCloseShift throws when shift is null", () => {
    expect(() => assertCanCloseShift(null)).toThrow(ShiftNotOpenError);
  });

  it("assertCanCloseShift throws when shift is already closed", () => {
    const closed: CashShift = {
      id: "s1", shopId: "shop_local", openedByUserId: "u1", openedAt: "o",
      openingBalancePaise: paise(0), openingDenominations: ZERO_DENOMINATIONS,
      closedAt: "c",
    };
    expect(() => assertCanCloseShift(closed)).toThrow(ShiftNotOpenError);
  });
});

describe("openShift — orchestration", () => {
  function makeRepo(initialOpen: CashShift | null = null): CashShiftRepo & { _stored: CashShift[] } {
    const stored: CashShift[] = initialOpen ? [initialOpen] : [];
    return {
      _stored: stored,
      async findOpenShift(shopId) {
        return stored.find((s) => s.shopId === shopId && !s.closedAt) ?? null;
      },
      async insert(s) { stored.push(s); return s; },
      async closeShift({ shiftId, closingDenominations, closingBalancePaise, expectedClosingPaise, variancePaise, zReportJson, closedByUserId, varianceApprovedByUserId }) {
        const idx = stored.findIndex((x) => x.id === shiftId);
        if (idx < 0) throw new Error("not found");
        const cur = stored[idx]!;
        const updated: CashShift = {
          ...cur,
          closedAt: "2026-04-28T22:00:00Z",
          closedByUserId,
          closingDenominations,
          closingBalancePaise,
          expectedClosingPaise,
          variancePaise,
          zReportJson,
          ...(varianceApprovedByUserId !== undefined ? { varianceApprovedByUserId } : {}),
        };
        stored[idx] = updated;
        return updated;
      },
    };
  }

  it("opens a shift when none active", async () => {
    const repo = makeRepo(null);
    const ids = vi.fn(() => "shift-uuid-1");
    const s = await openShift(repo, {
      shopId: "shop_local",
      openedByUserId: "u_owner",
      openingDenominations: { ...ZERO_DENOMINATIONS, d500: 4 }, // ₹2000
      shiftIdGenerator: ids,
      nowIso: "2026-04-28T10:00:00Z",
    });
    expect(s.id).toBe("shift-uuid-1");
    expect(s.openingBalancePaise).toBe(paise(200000));
    expect(repo._stored).toHaveLength(1);
  });

  it("rejects opening when one is already active", async () => {
    const open: CashShift = {
      id: "existing", shopId: "shop_local", openedByUserId: "u1", openedAt: "earlier",
      openingBalancePaise: paise(0), openingDenominations: ZERO_DENOMINATIONS,
    };
    const repo = makeRepo(open);
    await expect(openShift(repo, {
      shopId: "shop_local",
      openedByUserId: "u_owner",
      openingDenominations: ZERO_DENOMINATIONS,
      shiftIdGenerator: () => "new-shift",
    })).rejects.toThrow(ShiftAlreadyOpenError);
  });
});

describe("closeShift — orchestration with variance", () => {
  function makeRepo(open: CashShift): CashShiftRepo {
    let cur = open;
    return {
      async findOpenShift() { return cur.closedAt ? null : cur; },
      async insert(s) { cur = s; return s; },
      async closeShift(args) {
        cur = {
          ...cur,
          closedAt: "2026-04-28T22:00:00Z",
          closedByUserId: args.closedByUserId,
          closingDenominations: args.closingDenominations,
          closingBalancePaise: args.closingBalancePaise,
          expectedClosingPaise: args.expectedClosingPaise,
          variancePaise: args.variancePaise,
          zReportJson: args.zReportJson,
          ...(args.varianceApprovedByUserId !== undefined
            ? { varianceApprovedByUserId: args.varianceApprovedByUserId }
            : {}),
        };
        return cur;
      },
    };
  }

  const baseOpen: CashShift = {
    id: "shift-1",
    shopId: "shop_local",
    openedByUserId: "u_cashier",
    openedAt: "2026-04-28T10:00:00Z",
    openingBalancePaise: paise(500000),                      // ₹5000
    openingDenominations: { ...ZERO_DENOMINATIONS, d500: 10 },
  };

  it("closes shift with exact match", async () => {
    const repo = makeRepo({ ...baseOpen });
    const z = buildZReport({
      shiftId: "shift-1", shopId: "shop_local",
      periodStart: "open", periodEnd: "close",
      billCount: 10, returnCount: 0,
      totalSalesPaise: paise(2000000),
      totalReturnsPaise: paise(0),
      totalDiscountsPaise: paise(0),
      gstByHsn: {},
      tenderBreakdown: { ...EMPTY_TENDER, cash: paise(2000000) },
    });
    const closed = await closeShift(repo, {
      shiftId: "shift-1",
      closedByUserId: "u_cashier",
      closingDenominations: { ...ZERO_DENOMINATIONS, d500: 50 }, // ₹25000
      cashSalesPaise: paise(2000000),
      cashReturnsPaise: paise(0),
      cashRefundsPaise: paise(0),
      bankDepositsPaise: paise(0),
      zReport: z,
    });
    expect(closed.variancePaise).toBe(paise(0));
    expect(closed.expectedClosingPaise).toBe(paise(2500000));
  });

  it("rejects close when variance > threshold without approval", async () => {
    const repo = makeRepo({ ...baseOpen });
    const z = buildZReport({
      shiftId: "shift-1", shopId: "shop_local",
      periodStart: "o", periodEnd: "c",
      billCount: 0, returnCount: 0,
      totalSalesPaise: paise(0), totalReturnsPaise: paise(0), totalDiscountsPaise: paise(0),
      gstByHsn: {},
      tenderBreakdown: EMPTY_TENDER,
    });
    await expect(closeShift(repo, {
      shiftId: "shift-1",
      closedByUserId: "u_cashier",
      // count is ₹4400 — opening ₹5000 = -600 variance, > ₹500 threshold.
      closingDenominations: { ...ZERO_DENOMINATIONS, d500: 8, d100: 4 },
      cashSalesPaise: paise(0),
      cashReturnsPaise: paise(0),
      cashRefundsPaise: paise(0),
      bankDepositsPaise: paise(0),
      zReport: z,
    })).rejects.toThrow(VarianceRequiresApprovalError);
  });

  it("accepts close when variance > threshold WITH approval", async () => {
    const repo = makeRepo({ ...baseOpen });
    const z = buildZReport({
      shiftId: "shift-1", shopId: "shop_local",
      periodStart: "o", periodEnd: "c",
      billCount: 0, returnCount: 0,
      totalSalesPaise: paise(0), totalReturnsPaise: paise(0), totalDiscountsPaise: paise(0),
      gstByHsn: {},
      tenderBreakdown: EMPTY_TENDER,
    });
    const closed = await closeShift(repo, {
      shiftId: "shift-1",
      closedByUserId: "u_cashier",
      closingDenominations: { ...ZERO_DENOMINATIONS, d500: 8, d100: 4 },
      cashSalesPaise: paise(0),
      cashReturnsPaise: paise(0),
      cashRefundsPaise: paise(0),
      bankDepositsPaise: paise(0),
      zReport: z,
      varianceApprovedByUserId: "u_owner",
    });
    expect(closed.variancePaise).toBe(paise(-60000));         // shortage ₹600
    expect(closed.varianceApprovedByUserId).toBe("u_owner");
  });
});
