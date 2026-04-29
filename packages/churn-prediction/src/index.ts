// @pharmacare/churn-prediction
// RFM-style customer churn scoring + predicted refill date.
// ADR-0046. Pure logic; XGBoost training infra deferred. The RFM heuristic
// alone is industry-standard and beats most "do nothing" baselines.

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Inputs (caller queries from bills)
// ────────────────────────────────────────────────────────────────────────

export interface CustomerPurchase {
  readonly customerId: string;
  readonly billedAt: string;            // ISO
  readonly amountPaise: Paise;
  readonly hasRefillableItems: boolean; // true if at least one chronic-drug line
}

// ────────────────────────────────────────────────────────────────────────
// Output
// ────────────────────────────────────────────────────────────────────────

export interface ChurnScore {
  readonly customerId: string;
  readonly score: number;               // 0..1; higher = more likely to churn
  readonly daysSinceLastPurchase: number;
  readonly typicalCadenceDays: number | null;
  readonly expectedRefillDate?: string; // ISO; absent if cadence unknown
  readonly recommendedActionTemplate?: string;
  readonly rfmBuckets: { recencyBucket: 1 | 2 | 3 | 4 | 5; frequencyBucket: 1 | 2 | 3 | 4 | 5; monetaryBucket: 1 | 2 | 3 | 4 | 5 };
}

// ────────────────────────────────────────────────────────────────────────
// Math helpers
// ────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.floor((Date.parse(b) - Date.parse(a)) / DAY_MS));
}

/** Median of an array of numbers. Returns 0 for empty. */
export function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1]! + sorted[m]!) / 2 : sorted[m]!;
}

/** Compute median inter-purchase interval in days (cadence). null if < 2 purchases. */
export function typicalCadence(purchases: readonly CustomerPurchase[]): number | null {
  if (purchases.length < 2) return null;
  const sorted = [...purchases].sort((a, b) => Date.parse(a.billedAt) - Date.parse(b.billedAt));
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetween(sorted[i - 1]!.billedAt, sorted[i]!.billedAt));
  }
  return median(intervals);
}

// ────────────────────────────────────────────────────────────────────────
// RFM bucketing — 1 = best, 5 = worst (Marg/CRM convention)
// ────────────────────────────────────────────────────────────────────────

/** Recency bucket: 0-30d=1, 31-60=2, 61-90=3, 91-180=4, 181+=5 */
export function recencyBucket(daysSince: number): 1 | 2 | 3 | 4 | 5 {
  if (daysSince <= 30)  return 1;
  if (daysSince <= 60)  return 2;
  if (daysSince <= 90)  return 3;
  if (daysSince <= 180) return 4;
  return 5;
}

/** Frequency bucket: 12+ visits/yr=1, 6-11=2, 3-5=3, 1-2=4, 0=5 */
export function frequencyBucket(visitsLast12mo: number): 1 | 2 | 3 | 4 | 5 {
  if (visitsLast12mo >= 12) return 1;
  if (visitsLast12mo >= 6)  return 2;
  if (visitsLast12mo >= 3)  return 3;
  if (visitsLast12mo >= 1)  return 4;
  return 5;
}

/** Monetary bucket: ₹50k+/yr=1, 25-50k=2, 10-25k=3, 1-10k=4, <1k=5 */
export function monetaryBucket(annualSpendPaise: Paise): 1 | 2 | 3 | 4 | 5 {
  const rupees = (annualSpendPaise as number) / 100;
  if (rupees >= 50000) return 1;
  if (rupees >= 25000) return 2;
  if (rupees >= 10000) return 3;
  if (rupees >= 1000)  return 4;
  return 5;
}

// ────────────────────────────────────────────────────────────────────────
// Score computation
// ────────────────────────────────────────────────────────────────────────

export interface ScoreCustomerArgs {
  readonly customerId: string;
  readonly purchases: readonly CustomerPurchase[];
  readonly nowIso?: string;
}

export function scoreCustomer(a: ScoreCustomerArgs): ChurnScore {
  const now = a.nowIso ?? new Date().toISOString();

  if (a.purchases.length === 0) {
    return {
      customerId: a.customerId,
      score: 0.5,
      daysSinceLastPurchase: 0,
      typicalCadenceDays: null,
      rfmBuckets: { recencyBucket: 5, frequencyBucket: 5, monetaryBucket: 5 },
      recommendedActionTemplate: "FIRST_VISIT_OUTREACH",
    };
  }

  const sorted = [...a.purchases].sort((a, b) => Date.parse(a.billedAt) - Date.parse(b.billedAt));
  const last = sorted[sorted.length - 1]!;
  const daysSince = daysBetween(last.billedAt, now);
  const cadence = typicalCadence(sorted);

  // Visits in last 12 months
  const oneYearAgo = new Date(Date.parse(now) - 365 * DAY_MS).toISOString();
  const recent = sorted.filter((p) => p.billedAt >= oneYearAgo);
  const visits = recent.length;
  const annualSpendPaise = paise(recent.reduce((s, p) => s + (p.amountPaise as number), 0));

  const r = recencyBucket(daysSince);
  const f = frequencyBucket(visits);
  const m = monetaryBucket(annualSpendPaise);

  // Score formula: weighted RFM (recency dominates for churn).
  // Best=R1F1M1=score 0; worst=R5F5M5=score 1.
  const score = ((r - 1) * 0.5 + (f - 1) * 0.3 + (m - 1) * 0.2) / 4;

  // Cadence-based predicted next refill date
  let expectedRefillDate: string | undefined;
  if (cadence !== null && cadence > 0) {
    expectedRefillDate = new Date(Date.parse(last.billedAt) + cadence * DAY_MS).toISOString();
  }

  // Recommendation template
  let template: string | undefined;
  if (score > 0.7) template = "WIN_BACK_DISCOUNT";
  else if (score > 0.5) template = "REFILL_REMINDER";
  else if (cadence !== null && daysSince > cadence * 1.5) template = "CADENCE_BREAK_NUDGE";
  else if (last.hasRefillableItems && cadence !== null && daysSince > cadence) template = "REFILL_DUE_NOW";

  return {
    customerId: a.customerId,
    score,
    daysSinceLastPurchase: daysSince,
    typicalCadenceDays: cadence,
    ...(expectedRefillDate !== undefined ? { expectedRefillDate } : {}),
    ...(template !== undefined ? { recommendedActionTemplate: template } : {}),
    rfmBuckets: { recencyBucket: r, frequencyBucket: f, monetaryBucket: m },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Batch: rank-order customers most-at-risk first
// ────────────────────────────────────────────────────────────────────────

export function batchScore(args: {
  customers: ReadonlyArray<{ customerId: string; purchases: readonly CustomerPurchase[] }>;
  nowIso?: string;
}): readonly ChurnScore[] {
  return args.customers
    .map((c) => scoreCustomer({
      customerId: c.customerId,
      purchases: c.purchases,
      ...(args.nowIso !== undefined ? { nowIso: args.nowIso } : {}),
    }))
    .sort((a, b) => b.score - a.score);
}
