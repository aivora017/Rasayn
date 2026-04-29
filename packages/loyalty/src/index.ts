// @pharmacare/loyalty
// LTV-tier customer pricing + campaign matcher + cashback ledger.
// ADR-0054. Pure logic over preloaded tier table + campaign table.

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Tiers
// ────────────────────────────────────────────────────────────────────────

export type TierName = "bronze" | "silver" | "gold" | "platinum";

export interface LoyaltyTier {
  readonly tier: TierName;
  readonly minLifetimeSpendPaise: Paise;
  readonly defaultDiscountPct: number;       // 0..100
  readonly birthdayBonusPaise: Paise;
}

/** Default tiers — caller can override by passing their own table. */
export const DEFAULT_TIERS: readonly LoyaltyTier[] = [
  { tier: "bronze",   minLifetimeSpendPaise: paise(0),       defaultDiscountPct: 0, birthdayBonusPaise: paise(0)     },
  { tier: "silver",   minLifetimeSpendPaise: paise(2_500_00),  defaultDiscountPct: 1, birthdayBonusPaise: paise(100_00)  },
  { tier: "gold",     minLifetimeSpendPaise: paise(10_000_00), defaultDiscountPct: 2, birthdayBonusPaise: paise(500_00)  },
  { tier: "platinum", minLifetimeSpendPaise: paise(50_000_00), defaultDiscountPct: 3, birthdayBonusPaise: paise(2000_00) },
];

/** Highest tier whose min-spend ≤ lifetimeSpend. */
export function tierForSpend(
  lifetimeSpendPaise: Paise,
  tiers: readonly LoyaltyTier[] = DEFAULT_TIERS,
): LoyaltyTier {
  // tiers must be sorted ascending; we iterate descending to find first match.
  const sorted = [...tiers].sort((a, b) => (a.minLifetimeSpendPaise as number) - (b.minLifetimeSpendPaise as number));
  let chosen: LoyaltyTier | undefined = sorted[0];
  for (const t of sorted) {
    if (lifetimeSpendPaise >= t.minLifetimeSpendPaise) chosen = t;
  }
  if (!chosen) throw new Error("no tiers configured — at least 'bronze' minSpend=0 required");
  return chosen;
}

// ────────────────────────────────────────────────────────────────────────
// Campaigns
// ────────────────────────────────────────────────────────────────────────

export type CampaignTrigger =
  | { kind: "birthday" }
  | { kind: "drugClass"; atc: string }
  | { kind: "manual" };

export interface Campaign {
  readonly id: string;
  readonly shopId: string;
  readonly name: string;
  readonly trigger: CampaignTrigger;
  readonly discountPct?: number;
  readonly bonusPaise?: Paise;
  readonly validFrom: string;             // ISO
  readonly validTo: string;
  readonly active: boolean;
}

export interface CampaignContext {
  readonly nowIso?: string;
  readonly customerBirthDateIso?: string;
  readonly basketAtcClasses?: readonly string[];
}

/** Returns campaigns whose trigger fires for this customer/basket and which are
 *  active in the given time window. */
export function applicableCampaigns(
  campaigns: readonly Campaign[],
  ctx: CampaignContext,
): readonly Campaign[] {
  const now = ctx.nowIso ? new Date(ctx.nowIso) : new Date();
  const todayMonthDay = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return campaigns.filter((c) => {
    if (!c.active) return false;
    if (Date.parse(c.validFrom) > now.getTime()) return false;
    if (Date.parse(c.validTo)   < now.getTime()) return false;
    switch (c.trigger.kind) {
      case "birthday": {
        if (!ctx.customerBirthDateIso) return false;
        const bd = new Date(ctx.customerBirthDateIso);
        const bdMonthDay = `${String(bd.getMonth() + 1).padStart(2, "0")}-${String(bd.getDate()).padStart(2, "0")}`;
        return bdMonthDay === todayMonthDay;
      }
      case "drugClass":
        return (ctx.basketAtcClasses ?? []).includes(c.trigger.atc);
      case "manual":
        return true;
    }
  });
}

// ────────────────────────────────────────────────────────────────────────
// Effective discount calculation
// ────────────────────────────────────────────────────────────────────────

export interface DiscountCalcArgs {
  readonly tier: LoyaltyTier;
  readonly campaigns: readonly Campaign[];
  readonly subtotalPaise: Paise;
}

export interface DiscountCalcResult {
  readonly tierDiscountPaise: Paise;
  readonly campaignDiscountPaise: Paise;
  readonly bonusPaise: Paise;                // cashback to grant
  readonly totalDiscountPaise: Paise;
  readonly breakdown: ReadonlyArray<{ source: string; amountPaise: Paise }>;
}

/** Stack tier % + each campaign's discount/bonus. Discounts apply on subtotal,
 *  not nested. Cashback bonus accumulates separately (granted on bill save).
 *  Cap the discount at the subtotal — no negative bills. */
export function computeLoyaltyDiscount(args: DiscountCalcArgs): DiscountCalcResult {
  const breakdown: { source: string; amountPaise: Paise }[] = [];
  const sub = args.subtotalPaise as number;

  let discount = 0;
  if (args.tier.defaultDiscountPct > 0) {
    const d = Math.floor(sub * args.tier.defaultDiscountPct / 100);
    discount += d;
    breakdown.push({ source: `tier.${args.tier.tier}`, amountPaise: paise(d) });
  }
  let bonus = 0;
  for (const c of args.campaigns) {
    if (c.discountPct !== undefined && c.discountPct > 0) {
      const d = Math.floor(sub * c.discountPct / 100);
      discount += d;
      breakdown.push({ source: `campaign.${c.name}`, amountPaise: paise(d) });
    }
    if (c.bonusPaise !== undefined && (c.bonusPaise as number) > 0) {
      bonus += c.bonusPaise as number;
      breakdown.push({ source: `campaign.${c.name}.bonus`, amountPaise: c.bonusPaise });
    }
  }
  const cappedDiscount = Math.min(discount, sub);
  return {
    tierDiscountPaise: paise(args.tier.defaultDiscountPct > 0 ? Math.floor(sub * args.tier.defaultDiscountPct / 100) : 0),
    campaignDiscountPaise: paise(cappedDiscount - (args.tier.defaultDiscountPct > 0 ? Math.floor(sub * args.tier.defaultDiscountPct / 100) : 0)),
    bonusPaise: paise(bonus),
    totalDiscountPaise: paise(cappedDiscount),
    breakdown,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Cashback ledger — append-only.
// ────────────────────────────────────────────────────────────────────────

export interface CashbackEntry {
  readonly id: string;
  readonly customerId: string;
  readonly billId?: string;
  readonly deltaPaise: Paise;        // +earn, -redeem
  readonly reason: string;
  readonly createdAt: string;
}

/** Net cashback balance from a list of entries. */
export function cashbackBalance(entries: readonly CashbackEntry[]): Paise {
  let bal = 0;
  for (const e of entries) bal += e.deltaPaise as number;
  return paise(Math.max(0, bal));
}
