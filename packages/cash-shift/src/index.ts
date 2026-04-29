// @pharmacare/cash-shift
// Opening shift (denomination wizard) + day-close Z-report. ADR-0039.
//
// All monetary values in paise. Pure functions only — DB-backed callers
// (Tauri commands or the React screen) compose these with a DB layer.
//
// Test coverage (see index.test.ts):
//   * denomination math is exact at boundaries
//   * variance = closing actual - expected (positive = overage, negative = shortage)
//   * Z-report sums tender breakdown to the cash leg's expected total
//   * variance > ±50 paise demands manager approval (mirrors ADR-0039)
//   * shift cannot be opened twice without close (caller-side rule, modeled here)

import type { Paise } from "@pharmacare/shared-types";
import { paise, addP, subP } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Denominations. Indian currency: ₹2000, ₹500, ₹200, ₹100, ₹50, ₹20, ₹10
// notes; ₹5, ₹2, ₹1 coins.
// ────────────────────────────────────────────────────────────────────────

export interface DenominationCount {
  readonly d2000: number;
  readonly d500:  number;
  readonly d200:  number;
  readonly d100:  number;
  readonly d50:   number;
  readonly d20:   number;
  readonly d10:   number;
  readonly c5:    number;
  readonly c2:    number;
  readonly c1:    number;
}

export const ZERO_DENOMINATIONS: DenominationCount = {
  d2000: 0, d500: 0, d200: 0, d100: 0, d50: 0,
  d20: 0, d10: 0, c5: 0, c2: 0, c1: 0,
};

const FACE_VALUE_PAISE: Record<keyof DenominationCount, number> = {
  d2000: 200000, d500: 50000, d200: 20000, d100: 10000, d50: 5000,
  d20: 2000, d10: 1000, c5: 500, c2: 200, c1: 100,
};

/** Sum a denomination count to total paise. Pure. */
export function totalFromDenominations(d: DenominationCount): Paise {
  let total = 0;
  for (const k of Object.keys(FACE_VALUE_PAISE) as (keyof DenominationCount)[]) {
    const c = d[k];
    if (!Number.isInteger(c) || c < 0) {
      throw new InvalidDenominationCountError(k, c);
    }
    total += c * FACE_VALUE_PAISE[k];
  }
  return paise(total);
}

/** Negative or non-integer counts are rejected — bills are physical objects. */
export class InvalidDenominationCountError extends Error {
  public readonly code = "INVALID_DENOMINATION_COUNT" as const;
  public readonly denomination: keyof DenominationCount;
  public readonly value: number;
  constructor(denom: keyof DenominationCount, value: number) {
    super(`INVALID_DENOMINATION_COUNT: ${denom}=${value} must be a non-negative integer`);
    this.denomination = denom;
    this.value = value;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Shift records
// ────────────────────────────────────────────────────────────────────────

export interface CashShift {
  readonly id: string;
  readonly shopId: string;
  readonly openedByUserId: string;
  readonly openedAt: string;
  readonly openingBalancePaise: Paise;
  readonly openingDenominations: DenominationCount;
  readonly closedAt?: string;
  readonly closedByUserId?: string;
  readonly closingBalancePaise?: Paise;
  readonly closingDenominations?: DenominationCount;
  readonly expectedClosingPaise?: Paise;
  readonly variancePaise?: Paise;
  readonly varianceApprovedByUserId?: string;
  readonly zReportJson?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Z-report
// ────────────────────────────────────────────────────────────────────────

export interface TenderBreakdown {
  readonly cash:   Paise;
  readonly upi:    Paise;
  readonly card:   Paise;
  readonly cheque: Paise;
  readonly credit: Paise;
}

export const EMPTY_TENDER: TenderBreakdown = {
  cash: paise(0), upi: paise(0), card: paise(0), cheque: paise(0), credit: paise(0),
};

export interface ZReport {
  readonly shiftId: string;
  readonly shopId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly billCount: number;
  readonly returnCount: number;
  readonly totalSalesPaise: Paise;
  readonly totalReturnsPaise: Paise;
  readonly totalDiscountsPaise: Paise;
  readonly gstByHsn: Readonly<Record<string, Paise>>;
  readonly tenderBreakdown: TenderBreakdown;
}

// ────────────────────────────────────────────────────────────────────────
// Variance — the bit Z-report is really for. Expected = opening + cash sales
// - cash returns - cash refunds - bank deposits. Closing actual is whatever
// the cashier counts.
// ────────────────────────────────────────────────────────────────────────

export interface VarianceInputs {
  readonly openingBalancePaise: Paise;
  readonly cashSalesPaise: Paise;
  readonly cashReturnsPaise: Paise;
  readonly cashRefundsPaise: Paise;
  readonly bankDepositsPaise: Paise;
  readonly closingActualPaise: Paise;
}

export interface VarianceResult {
  readonly expectedClosingPaise: Paise;
  readonly variancePaise: Paise;            // actual − expected (positive = overage)
  readonly absVariancePaise: Paise;
  readonly requiresManagerApproval: boolean; // |variance| > 50 paise
  readonly category: "exact" | "overage" | "shortage";
}

/** Variance threshold above which manager (or higher) approval is required.
 *  Matches ADR-0039 §"variance approval flow at >₹500" — but expressed in
 *  paise so callers can change it via constant import. ₹500.00 = 50000 paise. */
export const VARIANCE_APPROVAL_THRESHOLD_PAISE: Paise = paise(50000);

/** Variance below this is rounding noise (paisa-level). Don't bother flagging. */
export const VARIANCE_NOISE_THRESHOLD_PAISE: Paise = paise(50);

export function computeVariance(v: VarianceInputs): VarianceResult {
  const expected = paise(
    v.openingBalancePaise +
    v.cashSalesPaise -
    v.cashReturnsPaise -
    v.cashRefundsPaise -
    v.bankDepositsPaise
  );
  const variance = subP(v.closingActualPaise, expected);
  const absVariance = paise(Math.abs(variance));
  const requiresApproval = absVariance > VARIANCE_APPROVAL_THRESHOLD_PAISE;
  const category: VarianceResult["category"] =
    absVariance <= VARIANCE_NOISE_THRESHOLD_PAISE ? "exact"
    : variance > 0 ? "overage" : "shortage";
  return {
    expectedClosingPaise: expected,
    variancePaise: variance,
    absVariancePaise: absVariance,
    requiresManagerApproval: requiresApproval,
    category,
  };
}

/** Total of denominations expressed as a quick "is this counted right?" sanity. */
export function reconcileDenominationsAgainstTotal(
  d: DenominationCount,
  expectedTotalPaise: Paise,
): { ok: boolean; deltaPaise: Paise } {
  const counted = totalFromDenominations(d);
  return {
    ok: counted === expectedTotalPaise,
    deltaPaise: subP(counted, expectedTotalPaise),
  };
}

// ────────────────────────────────────────────────────────────────────────
// State machine — pure rules; the DB layer enforces them transactionally.
// ────────────────────────────────────────────────────────────────────────

export class ShiftAlreadyOpenError extends Error {
  public readonly code = "SHIFT_ALREADY_OPEN" as const;
  public readonly existingShiftId: string;
  constructor(existingShiftId: string) {
    super(`SHIFT_ALREADY_OPEN: ${existingShiftId} — close it before opening a new shift`);
    this.existingShiftId = existingShiftId;
  }
}

export class ShiftNotOpenError extends Error {
  public readonly code = "SHIFT_NOT_OPEN" as const;
  constructor() { super("SHIFT_NOT_OPEN: open a shift before recording sales / closing"); }
}

/** Pure precondition check — caller queries DB for any open shift first. */
export function assertCanOpenShift(activeShift: CashShift | null): void {
  if (activeShift && !activeShift.closedAt) {
    throw new ShiftAlreadyOpenError(activeShift.id);
  }
}

/** Pure precondition — caller queries DB for the shift before closing. */
export function assertCanCloseShift(shift: CashShift | null): asserts shift is CashShift {
  if (!shift) throw new ShiftNotOpenError();
  if (shift.closedAt) throw new ShiftNotOpenError();
}

// ────────────────────────────────────────────────────────────────────────
// I/O ports the DB layer implements
// ────────────────────────────────────────────────────────────────────────

export interface CashShiftRepo {
  /** Returns the currently-open shift for this shop, or null. */
  findOpenShift(shopId: string): Promise<CashShift | null>;
  insert(shift: CashShift): Promise<CashShift>;
  closeShift(args: {
    shiftId: string;
    closedByUserId: string;
    closingDenominations: DenominationCount;
    closingBalancePaise: Paise;
    expectedClosingPaise: Paise;
    variancePaise: Paise;
    zReportJson: string;
    varianceApprovedByUserId?: string;
  }): Promise<CashShift>;
}

/**
 * High-level orchestration helpers — caller injects a repo so this package
 * stays DB-free.
 */
export async function openShift(
  repo: CashShiftRepo,
  args: {
    shopId: string;
    openedByUserId: string;
    openingDenominations: DenominationCount;
    shiftIdGenerator: () => string;       // typically uuidv7()
    nowIso?: string;
  },
): Promise<CashShift> {
  const active = await repo.findOpenShift(args.shopId);
  assertCanOpenShift(active);
  const openingBalance = totalFromDenominations(args.openingDenominations);
  const shift: CashShift = {
    id: args.shiftIdGenerator(),
    shopId: args.shopId,
    openedByUserId: args.openedByUserId,
    openedAt: args.nowIso ?? new Date().toISOString(),
    openingBalancePaise: openingBalance,
    openingDenominations: args.openingDenominations,
  };
  return repo.insert(shift);
}

export async function closeShift(
  repo: CashShiftRepo,
  args: {
    shiftId: string;
    closedByUserId: string;
    closingDenominations: DenominationCount;
    /** Provided by the caller's accounting query (sum of bills.payments where
     *  mode=cash and shift_id=this — minus cash returns / refunds / deposits). */
    cashSalesPaise: Paise;
    cashReturnsPaise: Paise;
    cashRefundsPaise: Paise;
    bankDepositsPaise: Paise;
    /** Pre-computed Z-report payload (see buildZReport) — caller persists it. */
    zReport: ZReport;
    /** If variance > threshold, owner/manager must sign — provide their id. */
    varianceApprovedByUserId?: string;
  },
): Promise<CashShift> {
  const closingActual = totalFromDenominations(args.closingDenominations);

  // Re-fetch to get opening balance for variance math.
  const all = await repo.findOpenShift(args.zReport.shopId);
  if (!all || all.id !== args.shiftId) throw new ShiftNotOpenError();

  const v = computeVariance({
    openingBalancePaise: all.openingBalancePaise,
    cashSalesPaise: args.cashSalesPaise,
    cashReturnsPaise: args.cashReturnsPaise,
    cashRefundsPaise: args.cashRefundsPaise,
    bankDepositsPaise: args.bankDepositsPaise,
    closingActualPaise: closingActual,
  });

  if (v.requiresManagerApproval && !args.varianceApprovedByUserId) {
    throw new VarianceRequiresApprovalError(v.variancePaise);
  }

  return repo.closeShift({
    shiftId: args.shiftId,
    closedByUserId: args.closedByUserId,
    closingDenominations: args.closingDenominations,
    closingBalancePaise: closingActual,
    expectedClosingPaise: v.expectedClosingPaise,
    variancePaise: v.variancePaise,
    zReportJson: JSON.stringify(args.zReport),
    ...(args.varianceApprovedByUserId !== undefined
      ? { varianceApprovedByUserId: args.varianceApprovedByUserId }
      : {}),
  });
}

export class VarianceRequiresApprovalError extends Error {
  public readonly code = "VARIANCE_REQUIRES_APPROVAL" as const;
  public readonly variancePaise: Paise;
  constructor(variance: Paise) {
    super(
      `VARIANCE_REQUIRES_APPROVAL: variance ${variance} paise exceeds threshold ` +
      `${VARIANCE_APPROVAL_THRESHOLD_PAISE} paise — manager approval required`,
    );
    this.variancePaise = variance;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Z-report build helper. Aggregator is DB-side; this just composes.
// ────────────────────────────────────────────────────────────────────────

export interface ZReportInputs {
  readonly shiftId: string;
  readonly shopId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly billCount: number;
  readonly returnCount: number;
  readonly totalSalesPaise: Paise;
  readonly totalReturnsPaise: Paise;
  readonly totalDiscountsPaise: Paise;
  readonly gstByHsn: Readonly<Record<string, Paise>>;
  readonly tenderBreakdown: TenderBreakdown;
}

export function buildZReport(inputs: ZReportInputs): ZReport {
  return {
    shiftId: inputs.shiftId,
    shopId: inputs.shopId,
    periodStart: inputs.periodStart,
    periodEnd: inputs.periodEnd,
    billCount: inputs.billCount,
    returnCount: inputs.returnCount,
    totalSalesPaise: inputs.totalSalesPaise,
    totalReturnsPaise: inputs.totalReturnsPaise,
    totalDiscountsPaise: inputs.totalDiscountsPaise,
    gstByHsn: inputs.gstByHsn,
    tenderBreakdown: inputs.tenderBreakdown,
  };
}

/** Sum the tender breakdown — convenience for "total tendered today" UIs. */
export function sumTenders(t: TenderBreakdown): Paise {
  return paise(t.cash + t.upi + t.card + t.cheque + t.credit);
}
