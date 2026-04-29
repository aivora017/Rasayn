// @pharmacare/khata
// Customer credit ledger ("khata"). Append-only entries; balances + aging
// buckets are derived. ADR-0040.
//
// Bucket boundaries match ICAI accounts-receivable convention:
//   current  = 0..30 days
//   thirty   = 30..60 days
//   sixty    = 60..90 days
//   ninetyP  = 90+ days   (this is what triggers dunning + risk score)
//
// All math here is pure. Caller injects a KhataRepo that does the DB work.

import type { Paise } from "@pharmacare/shared-types";
import { paise, addP, subP } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface KhataEntry {
  readonly id: string;
  readonly customerId: string;
  readonly billId?: string;
  readonly debitPaise: Paise;
  readonly creditPaise: Paise;
  readonly createdAt: string;          // ISO 8601
  readonly note?: string;
  readonly recordedByUserId: string;
}

export interface KhataAging {
  readonly customerId: string;
  readonly current: Paise;             // 0–30 d
  readonly thirty: Paise;              // 30–60 d
  readonly sixty:  Paise;              // 60–90 d
  readonly ninetyPlus: Paise;          // 90+ d
  readonly totalDuePaise: Paise;
  readonly oldestDueDate: string | null;
}

export const ZERO_AGING = (customerId: string): KhataAging => ({
  customerId,
  current: paise(0), thirty: paise(0), sixty: paise(0), ninetyPlus: paise(0),
  totalDuePaise: paise(0),
  oldestDueDate: null,
});

export interface CustomerCreditLimit {
  readonly customerId: string;
  readonly creditLimitPaise: Paise;
  readonly currentDuePaise: Paise;
  readonly defaultRiskScore: number;   // 0..1
  readonly updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Domain errors
// ────────────────────────────────────────────────────────────────────────

export class CreditLimitExceededError extends Error {
  public readonly code = "CREDIT_LIMIT_EXCEEDED" as const;
  public readonly customerId: string;
  public readonly limitPaise: Paise;
  public readonly attemptedDuePaise: Paise;
  constructor(customerId: string, limit: Paise, attempted: Paise) {
    super(
      `CREDIT_LIMIT_EXCEEDED: customer ${customerId} would owe ${attempted} paise, ` +
      `limit is ${limit} paise`,
    );
    this.customerId = customerId;
    this.limitPaise = limit;
    this.attemptedDuePaise = attempted;
  }
}

export class InvalidEntryError extends Error {
  public readonly code = "INVALID_ENTRY" as const;
  constructor(reason: string) { super(`INVALID_ENTRY: ${reason}`); }
}

// ────────────────────────────────────────────────────────────────────────
// Pure aging math
// ────────────────────────────────────────────────────────────────────────

/** Age (in whole days) of an entry as of `now`. */
export function ageInDays(entryCreatedAtIso: string, now: Date = new Date()): number {
  const t = Date.parse(entryCreatedAtIso);
  if (Number.isNaN(t)) return 0;
  const diffMs = now.getTime() - t;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/** Roll up entries into aging buckets.  Pure function. */
export function computeAging(
  customerId: string,
  entries: readonly KhataEntry[],
  now: Date = new Date(),
): KhataAging {
  // Net debit/credit per entry decides which bucket the residual sits in.
  // We FIFO-match credits against the oldest debits so a payment cleans
  // ninetyPlus first (matches expectation in real ledgers).
  const debits = entries
    .filter((e) => e.debitPaise > 0)
    .map((e) => ({ ...e, _remaining: e.debitPaise as number }))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const credits = entries
    .filter((e) => e.creditPaise > 0)
    .reduce((acc, e) => acc + (e.creditPaise as number), 0);
  let creditPool = credits;

  for (const d of debits) {
    if (creditPool <= 0) break;
    if (creditPool >= d._remaining) {
      creditPool -= d._remaining;
      d._remaining = 0;
    } else {
      d._remaining -= creditPool;
      creditPool = 0;
    }
  }

  let current = 0, thirty = 0, sixty = 0, ninetyPlus = 0;
  let oldest: string | null = null;
  for (const d of debits) {
    if (d._remaining <= 0) continue;
    if (oldest === null || Date.parse(d.createdAt) < Date.parse(oldest)) {
      oldest = d.createdAt;
    }
    const age = ageInDays(d.createdAt, now);
    if (age < 30)        current   += d._remaining;
    else if (age < 60)   thirty    += d._remaining;
    else if (age < 90)   sixty     += d._remaining;
    else                  ninetyPlus += d._remaining;
  }

  const total = current + thirty + sixty + ninetyPlus;
  return {
    customerId,
    current: paise(current),
    thirty: paise(thirty),
    sixty: paise(sixty),
    ninetyPlus: paise(ninetyPlus),
    totalDuePaise: paise(total),
    oldestDueDate: oldest,
  };
}

/** Heuristic risk score 0..1 (production model lives in @pharmacare/churn-prediction).
 *  Used as the cached default_risk_score on the customer-limits row. */
export function heuristicRiskScore(aging: KhataAging, limit: Paise): number {
  if (aging.totalDuePaise === 0) return 0;
  const utilisation = limit > 0 ? Math.min(1, aging.totalDuePaise / limit) : 1;
  // 90+ day balances drag risk hard.
  const oldRatio = aging.totalDuePaise > 0 ? aging.ninetyPlus / aging.totalDuePaise : 0;
  // Weighted: half from utilisation, half from old-balance share.
  return Math.min(1, 0.5 * utilisation + 0.5 * oldRatio);
}

// ────────────────────────────────────────────────────────────────────────
// I/O port
// ────────────────────────────────────────────────────────────────────────

export interface KhataRepo {
  listEntriesForCustomer(customerId: string): Promise<readonly KhataEntry[]>;
  getCreditLimit(customerId: string): Promise<CustomerCreditLimit | null>;
  upsertCreditLimit(c: CustomerCreditLimit): Promise<void>;
  insertEntry(e: KhataEntry): Promise<KhataEntry>;
}

// ────────────────────────────────────────────────────────────────────────
// Orchestration helpers
// ────────────────────────────────────────────────────────────────────────

/** Record a credit-bill (customer takes goods on khata). Validates limit. */
export async function recordCreditPurchase(
  repo: KhataRepo,
  args: {
    entryIdGenerator: () => string;
    customerId: string;
    billId: string;
    amountPaise: Paise;
    recordedByUserId: string;
    note?: string;
    nowIso?: string;
  },
): Promise<KhataEntry> {
  if (args.amountPaise <= 0) {
    throw new InvalidEntryError(`debitPaise must be > 0 (was ${args.amountPaise})`);
  }
  const limit = await repo.getCreditLimit(args.customerId);
  const limitPaise = limit?.creditLimitPaise ?? paise(0);
  const currentDue = limit?.currentDuePaise ?? paise(0);
  const wouldOwe = addP(currentDue, args.amountPaise);

  if (wouldOwe > limitPaise) {
    throw new CreditLimitExceededError(args.customerId, limitPaise, wouldOwe);
  }

  const entry: KhataEntry = {
    id: args.entryIdGenerator(),
    customerId: args.customerId,
    billId: args.billId,
    debitPaise: args.amountPaise,
    creditPaise: paise(0),
    createdAt: args.nowIso ?? new Date().toISOString(),
    recordedByUserId: args.recordedByUserId,
    ...(args.note !== undefined ? { note: args.note } : {}),
  };
  await repo.insertEntry(entry);
  // Refresh cached current_due on customer-limits row.
  const newLimit: CustomerCreditLimit = {
    customerId: args.customerId,
    creditLimitPaise: limitPaise,
    currentDuePaise: wouldOwe,
    defaultRiskScore: limit?.defaultRiskScore ?? 0,
    updatedAt: args.nowIso ?? new Date().toISOString(),
  };
  await repo.upsertCreditLimit(newLimit);
  return entry;
}

/** Record a payment (customer settles part or whole of khata). */
export async function recordPayment(
  repo: KhataRepo,
  args: {
    entryIdGenerator: () => string;
    customerId: string;
    amountPaise: Paise;
    recordedByUserId: string;
    note?: string;
    nowIso?: string;
  },
): Promise<KhataEntry> {
  if (args.amountPaise <= 0) {
    throw new InvalidEntryError(`creditPaise must be > 0 (was ${args.amountPaise})`);
  }
  const entry: KhataEntry = {
    id: args.entryIdGenerator(),
    customerId: args.customerId,
    debitPaise: paise(0),
    creditPaise: args.amountPaise,
    createdAt: args.nowIso ?? new Date().toISOString(),
    recordedByUserId: args.recordedByUserId,
    ...(args.note !== undefined ? { note: args.note } : {}),
  };
  await repo.insertEntry(entry);
  // Refresh cached current_due.
  const limit = await repo.getCreditLimit(args.customerId);
  const newDue = paise(Math.max(0, (limit?.currentDuePaise ?? paise(0)) - args.amountPaise));
  await repo.upsertCreditLimit({
    customerId: args.customerId,
    creditLimitPaise: limit?.creditLimitPaise ?? paise(0),
    currentDuePaise: newDue,
    defaultRiskScore: limit?.defaultRiskScore ?? 0,
    updatedAt: args.nowIso ?? new Date().toISOString(),
  });
  return entry;
}

/** Compute aging on demand for a customer (fresh from ledger). */
export async function ageingForCustomer(
  repo: KhataRepo,
  customerId: string,
  now: Date = new Date(),
): Promise<KhataAging> {
  const entries = await repo.listEntriesForCustomer(customerId);
  if (entries.length === 0) return ZERO_AGING(customerId);
  return computeAging(customerId, entries, now);
}

// Re-export helpers Ts callers expect to see.
export { addP, subP };
