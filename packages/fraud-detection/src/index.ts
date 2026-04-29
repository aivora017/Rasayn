// @pharmacare/fraud-detection
// Staff-theft / refund-abuse anomaly detection.
// ADR-0045. Pure-logic implementation: feature engineering + threshold-rule
// scoring + LLM-narrative templating. Real Isolation Forest deferred — the
// rule engine catches the high-leverage cases today.
//
// Categories (matches migration 0029):
//   * high-discount-rate    — staff giving abnormally high % discounts
//   * after-hours           — bills outside posted shop hours
//   * frequent-voids        — staff voiding > N bills/day
//   * duplicate-refunds     — same bill refunded twice
//   * schedX-velocity       — Schedule X dispenses spiking vs baseline

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Feature inputs (caller queries from bills/payments/audit_log)
// ────────────────────────────────────────────────────────────────────────

export interface BillFeature {
  readonly billId: string;
  readonly billNo: string;
  readonly userId: string;
  readonly billedAt: string;            // ISO with offset
  readonly grandTotalPaise: Paise;
  readonly discountPaise: Paise;
  readonly subtotalPaise: Paise;        // pre-discount
  readonly voided: boolean;
  readonly schedXLineCount: number;     // 0 for normal bills
}

export interface RefundFeature {
  readonly returnId: string;
  readonly originalBillId: string;
  readonly userId: string;
  readonly refundedAt: string;
  readonly refundPaise: Paise;
}

export interface ShopHours {
  /** "06:00" - "22:00" — anything outside is "after-hours". */
  readonly openTime: string;
  readonly closeTime: string;
}

// ────────────────────────────────────────────────────────────────────────
// Alert types (matches migration 0029)
// ────────────────────────────────────────────────────────────────────────

export type FraudCategory =
  | "high-discount-rate"
  | "after-hours"
  | "frequent-voids"
  | "duplicate-refunds"
  | "schedX-velocity";

export interface FraudAlert {
  readonly id: string;
  readonly shopId: string;
  readonly userId: string;
  readonly category: FraudCategory;
  readonly score: number;                // 0..1
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly narrative: string;            // human-readable + LLM-ish wording
  readonly evidenceBillIds: readonly string[];
}

// ────────────────────────────────────────────────────────────────────────
// Thresholds (calibrated against pilot fixtures; all overridable)
// ────────────────────────────────────────────────────────────────────────

export interface FraudThresholds {
  /** Discount-rate flag: > N% average across bills in window */
  readonly highDiscountAvgPct: number;
  /** Min number of bills the user must have processed for the rate to be meaningful */
  readonly highDiscountMinBills: number;
  /** Frequent-voids flag: > N voids in window */
  readonly frequentVoidsCount: number;
  /** schedX velocity: ≥ N dispenses in window when baseline is ≤ N/3 */
  readonly schedXVelocityCount: number;
}

export const DEFAULT_THRESHOLDS: FraudThresholds = {
  highDiscountAvgPct: 8,
  highDiscountMinBills: 10,
  frequentVoidsCount: 3,
  schedXVelocityCount: 6,
};

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

export function isAfterHours(billedAt: string, hours: ShopHours): boolean {
  // Extract HH:MM from ISO; falls back to false on parse failure.
  const m = /T(\d{2}):(\d{2})/.exec(billedAt);
  if (!m) return false;
  const billHm = `${m[1]}:${m[2]}`;
  return billHm < hours.openTime || billHm > hours.closeTime;
}

function pctDiscount(b: BillFeature): number {
  const sub = b.subtotalPaise as number;
  if (sub <= 0) return 0;
  return ((b.discountPaise as number) / sub) * 100;
}

function id(category: FraudCategory, userId: string, windowStart: string): string {
  return `fa_${category}_${userId}_${windowStart.replace(/[:T.Z-]/g, "")}`;
}

// ────────────────────────────────────────────────────────────────────────
// Detectors — each is a pure function the orchestrator runs in turn
// ────────────────────────────────────────────────────────────────────────

export function detectHighDiscount(
  bills: readonly BillFeature[],
  th: FraudThresholds = DEFAULT_THRESHOLDS,
): readonly Omit<FraudAlert, "id" | "shopId">[] {
  const byUser = new Map<string, BillFeature[]>();
  for (const b of bills) {
    const arr = byUser.get(b.userId) ?? []; arr.push(b); byUser.set(b.userId, arr);
  }
  const out: Omit<FraudAlert, "id" | "shopId">[] = [];
  for (const [userId, userBills] of byUser) {
    if (userBills.length < th.highDiscountMinBills) continue;
    const avg = userBills.reduce((s, b) => s + pctDiscount(b), 0) / userBills.length;
    if (avg > th.highDiscountAvgPct) {
      const score = Math.min(1, (avg - th.highDiscountAvgPct) / 20);  // 8% → 0; 28% → 1
      const evidence = [...userBills].sort((a, b) => pctDiscount(b) - pctDiscount(a)).slice(0, 5).map((b) => b.billId);
      out.push({
        userId, category: "high-discount-rate", score,
        windowStart: userBills[0]!.billedAt,
        windowEnd: userBills[userBills.length - 1]!.billedAt,
        narrative: `User ${userId} averaged ${avg.toFixed(1)}% discount across ${userBills.length} bills (threshold ${th.highDiscountAvgPct}%). ` +
                   `Top 5 bills attached as evidence — review for unauthorized markdowns or staff-friend bills.`,
        evidenceBillIds: evidence,
      });
    }
  }
  return out;
}

export function detectAfterHours(
  bills: readonly BillFeature[],
  hours: ShopHours,
): readonly Omit<FraudAlert, "id" | "shopId">[] {
  const offending = bills.filter((b) => isAfterHours(b.billedAt, hours));
  if (offending.length === 0) return [];
  const byUser = new Map<string, BillFeature[]>();
  for (const b of offending) {
    const arr = byUser.get(b.userId) ?? []; arr.push(b); byUser.set(b.userId, arr);
  }
  const out: Omit<FraudAlert, "id" | "shopId">[] = [];
  for (const [userId, userBills] of byUser) {
    out.push({
      userId, category: "after-hours",
      score: Math.min(1, userBills.length / 10),
      windowStart: userBills[0]!.billedAt,
      windowEnd: userBills[userBills.length - 1]!.billedAt,
      narrative: `User ${userId} created ${userBills.length} bill${userBills.length === 1 ? "" : "s"} outside posted shop hours ` +
                 `(${hours.openTime}–${hours.closeTime}). After-hours billing should be authorized in advance.`,
      evidenceBillIds: userBills.map((b) => b.billId),
    });
  }
  return out;
}

export function detectFrequentVoids(
  bills: readonly BillFeature[],
  th: FraudThresholds = DEFAULT_THRESHOLDS,
): readonly Omit<FraudAlert, "id" | "shopId">[] {
  const voids = bills.filter((b) => b.voided);
  if (voids.length === 0) return [];
  const byUser = new Map<string, BillFeature[]>();
  for (const b of voids) {
    const arr = byUser.get(b.userId) ?? []; arr.push(b); byUser.set(b.userId, arr);
  }
  const out: Omit<FraudAlert, "id" | "shopId">[] = [];
  for (const [userId, userBills] of byUser) {
    if (userBills.length < th.frequentVoidsCount) continue;
    const score = Math.min(1, userBills.length / 15);
    out.push({
      userId, category: "frequent-voids", score,
      windowStart: userBills[0]!.billedAt,
      windowEnd: userBills[userBills.length - 1]!.billedAt,
      narrative: `User ${userId} voided ${userBills.length} bills (threshold ${th.frequentVoidsCount}). ` +
                 `High void counts can indicate cancelled-after-cash-taken theft. Review each void's reason.`,
      evidenceBillIds: userBills.map((b) => b.billId),
    });
  }
  return out;
}

export function detectDuplicateRefunds(
  refunds: readonly RefundFeature[],
): readonly Omit<FraudAlert, "id" | "shopId">[] {
  const byBill = new Map<string, RefundFeature[]>();
  for (const r of refunds) {
    const arr = byBill.get(r.originalBillId) ?? []; arr.push(r); byBill.set(r.originalBillId, arr);
  }
  const out: Omit<FraudAlert, "id" | "shopId">[] = [];
  for (const [originalBillId, rs] of byBill) {
    if (rs.length < 2) continue;
    const userId = rs[0]!.userId;
    out.push({
      userId, category: "duplicate-refunds",
      score: Math.min(1, rs.length / 4),
      windowStart: rs[0]!.refundedAt,
      windowEnd: rs[rs.length - 1]!.refundedAt,
      narrative: `Bill ${originalBillId} was refunded ${rs.length} times — almost always a sign of ` +
                 `duplicate-refund fraud or a system race. Audit the bill's full payment + refund chain.`,
      evidenceBillIds: [originalBillId],
    });
  }
  return out;
}

export function detectSchedXVelocity(
  bills: readonly BillFeature[],
  th: FraudThresholds = DEFAULT_THRESHOLDS,
): readonly Omit<FraudAlert, "id" | "shopId">[] {
  const xBills = bills.filter((b) => b.schedXLineCount > 0);
  if (xBills.length < th.schedXVelocityCount) return [];
  const byUser = new Map<string, BillFeature[]>();
  for (const b of xBills) {
    const arr = byUser.get(b.userId) ?? []; arr.push(b); byUser.set(b.userId, arr);
  }
  const out: Omit<FraudAlert, "id" | "shopId">[] = [];
  for (const [userId, userBills] of byUser) {
    if (userBills.length < th.schedXVelocityCount) continue;
    out.push({
      userId, category: "schedX-velocity",
      score: Math.min(1, userBills.length / 12),
      windowStart: userBills[0]!.billedAt,
      windowEnd: userBills[userBills.length - 1]!.billedAt,
      narrative: `User ${userId} dispensed Schedule X drugs on ${userBills.length} bills in this window — ` +
                 `well above baseline. Verify each Rx + witness signature; possible NDPS register fraud.`,
      evidenceBillIds: userBills.map((b) => b.billId),
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────

export interface DetectAnomaliesArgs {
  readonly shopId: string;
  readonly bills: readonly BillFeature[];
  readonly refunds: readonly RefundFeature[];
  readonly hours: ShopHours;
  readonly thresholds?: FraudThresholds;
}

export function detectAnomalies(a: DetectAnomaliesArgs): readonly FraudAlert[] {
  const th = a.thresholds ?? DEFAULT_THRESHOLDS;
  const partials = [
    ...detectHighDiscount(a.bills, th),
    ...detectAfterHours(a.bills, a.hours),
    ...detectFrequentVoids(a.bills, th),
    ...detectDuplicateRefunds(a.refunds),
    ...detectSchedXVelocity(a.bills, th),
  ];
  return partials.map((p) => ({
    ...p,
    id: id(p.category, p.userId, p.windowStart),
    shopId: a.shopId,
  }));
}

// Re-export so consumers can build their own combined list
export const DETECTORS = {
  highDiscount: detectHighDiscount,
  afterHours: detectAfterHours,
  frequentVoids: detectFrequentVoids,
  duplicateRefunds: detectDuplicateRefunds,
  schedXVelocity: detectSchedXVelocity,
} as const;
