// LoyaltyScreen — tier ribbon + active campaigns + cashback ledger.

import { useCallback, useEffect, useMemo, useState } from "react";
import { HeartHandshake, Plus, Calendar, Tag, Coins } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import { paise, formatINR, type Paise } from "@pharmacare/shared-types";
import {
  tierForSpend, applicableCampaigns, computeLoyaltyDiscount, cashbackBalance,
  DEFAULT_TIERS, type Campaign, type CashbackEntry, type LoyaltyTier,
} from "@pharmacare/loyalty";

const tierColor: Record<string, string> = {
  bronze:   "text-amber-700",
  silver:   "text-slate-400",
  gold:     "text-yellow-500",
  platinum: "text-cyan-300",
};

interface MockCustomer {
  id: string; name: string; lifetimeSpendPaise: number;
  birthDateIso?: string; entries: CashbackEntry[];
}

const DEMO_CUSTOMERS: MockCustomer[] = [
  { id: "c1", name: "Priya Sharma",   lifetimeSpendPaise: 65_000_00, birthDateIso: "1990-04-28",
    entries: [
      { id: "e1", customerId: "c1", deltaPaise: paise(15000), reason: "Bill #B-201 cashback", createdAt: "2026-04-20" },
      { id: "e2", customerId: "c1", deltaPaise: paise(-3000), reason: "Redeemed at bill #B-225", createdAt: "2026-04-25" },
    ],
  },
  { id: "c2", name: "Ramesh Kumar",   lifetimeSpendPaise: 28_000_00, birthDateIso: "1985-06-15",
    entries: [
      { id: "e3", customerId: "c2", deltaPaise: paise(5000), reason: "Bill #B-180 cashback", createdAt: "2026-04-15" },
    ],
  },
  { id: "c3", name: "Asha Iyer",      lifetimeSpendPaise: 6_500_00,  birthDateIso: "1995-11-22", entries: [] },
];

const DEMO_CAMPAIGNS: Campaign[] = [
  { id: "k1", shopId: "shop_local", name: "Birthday cashback ₹100",
    trigger: { kind: "birthday" }, bonusPaise: paise(10000),
    validFrom: "2026-01-01", validTo: "2026-12-31", active: true },
  { id: "k2", shopId: "shop_local", name: "5% off antihypertensive course",
    trigger: { kind: "drugClass", atc: "C09" }, discountPct: 5,
    validFrom: "2026-04-01", validTo: "2026-05-31", active: true },
];

export default function LoyaltyScreen(): React.ReactElement {
  const [selectedId, setSelectedId] = useState(DEMO_CUSTOMERS[0]!.id);
  const customer = useMemo(() => DEMO_CUSTOMERS.find((c) => c.id === selectedId)!, [selectedId]);
  const tier: LoyaltyTier = useMemo(() => tierForSpend(paise(customer.lifetimeSpendPaise)), [customer]);
  const today = "2026-04-28T12:00:00Z";
  const campaigns = useMemo(() => applicableCampaigns(DEMO_CAMPAIGNS, {
    nowIso: today,
    ...(customer.birthDateIso ? { customerBirthDateIso: customer.birthDateIso } : {}),
    basketAtcClasses: ["C09"],          // demo: simulating customer in an antihypertensive basket
  }), [customer]);
  const balance = useMemo(() => cashbackBalance(customer.entries), [customer]);

  const sampleDiscount = useMemo(() => computeLoyaltyDiscount({
    tier, campaigns, subtotalPaise: paise(100000),       // illustrative ₹1000 basket
  }), [tier, campaigns]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="loyalty">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HeartHandshake size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Loyalty & Campaigns</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              4-tier customer ranking · birthday + drug-class campaigns · cashback ledger
            </p>
          </div>
        </div>
      </header>

      {/* Customer picker */}
      <Glass>
        <div className="p-3 flex items-center gap-2">
          <span className="text-[11px] uppercase text-[var(--pc-text-tertiary)] font-medium">Demo customer</span>
          <select
            value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
            className="bg-transparent border border-[var(--pc-border-subtle)] rounded px-2 py-1 text-[13px]"
          >
            {DEMO_CUSTOMERS.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {formatINR(paise(c.lifetimeSpendPaise))} lifetime</option>
            ))}
          </select>
        </div>
      </Glass>

      {/* Tier ribbon */}
      <Glass>
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tag size={16} className={tierColor[tier.tier]} aria-hidden />
            <div>
              <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Current tier</div>
              <div className={`font-semibold text-[18px] ${tierColor[tier.tier]}`}>
                {tier.tier.toUpperCase()}
              </div>
              <div className="text-[12px] text-[var(--pc-text-secondary)]">
                {tier.defaultDiscountPct}% default discount · birthday bonus {formatINR(tier.birthdayBonusPaise)}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Lifetime spend</div>
            <div className="font-mono tabular-nums text-[18px]">{formatINR(paise(customer.lifetimeSpendPaise))}</div>
          </div>
        </div>
      </Glass>

      {/* Active campaigns + sample discount */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Glass>
          <div className="p-4 flex flex-col gap-2" data-testid="active-campaigns">
            <div className="flex items-center gap-2">
              <Calendar size={14} aria-hidden />
              <h2 className="font-medium text-[14px]">Active campaigns ({campaigns.length})</h2>
            </div>
            {campaigns.length === 0 ? (
              <div className="text-[12px] text-[var(--pc-text-tertiary)] py-4 text-center">No active campaigns for this customer today.</div>
            ) : (
              <ul className="space-y-2">
                {campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-[13px]">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[11px] text-[var(--pc-text-tertiary)]">
                        {c.trigger.kind === "birthday" ? "🎂 Birthday today"
                          : c.trigger.kind === "drugClass" ? `Drug class ${c.trigger.atc}`
                          : "Manual"}
                      </div>
                    </div>
                    {c.discountPct ? (
                      <Badge variant="success">{c.discountPct}% off</Badge>
                    ) : c.bonusPaise ? (
                      <Badge variant="info">+{formatINR(c.bonusPaise)} cashback</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Glass>

        <Glass>
          <div className="p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Coins size={14} aria-hidden />
              <h2 className="font-medium text-[14px]">Sample discount on ₹1,000 basket</h2>
            </div>
            <table className="text-[12px] w-full">
              <tbody>
                {sampleDiscount.breakdown.length === 0 ? (
                  <tr><td className="text-[var(--pc-text-tertiary)] py-2">No discounts applicable</td></tr>
                ) : sampleDiscount.breakdown.map((b, i) => (
                  <tr key={i} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-1.5 text-[var(--pc-text-secondary)]">{b.source}</td>
                    <td className="py-1.5 font-mono tabular-nums text-right">{formatINR(b.amountPaise)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--pc-border-subtle)]">
                  <td className="py-1.5 font-medium">Total discount</td>
                  <td className="py-1.5 font-mono tabular-nums text-right text-[var(--pc-state-success)]">
                    {formatINR(sampleDiscount.totalDiscountPaise)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-medium">Cashback to grant</td>
                  <td className="py-1.5 font-mono tabular-nums text-right text-[var(--pc-state-info)]">
                    +{formatINR(sampleDiscount.bonusPaise)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Glass>
      </div>

      {/* Cashback ledger */}
      <Glass>
        <div className="p-4 flex flex-col gap-2" data-testid="cashback-ledger">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-[14px]">Cashback ledger</h2>
            <span className="text-[13px]">
              Balance: <strong className="font-mono tabular-nums">{formatINR(balance)}</strong>
            </span>
          </div>
          {customer.entries.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-4 text-center">No cashback history</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)] text-left">
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 font-medium">Reason</th>
                  <th className="py-1 font-medium text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {customer.entries.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-1.5">{new Date(e.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="py-1.5 text-[var(--pc-text-secondary)]">{e.reason}</td>
                    <td className={`py-1.5 font-mono tabular-nums text-right ${e.deltaPaise > 0 ? "text-[var(--pc-state-success)]" : "text-[var(--pc-state-danger)]"}`}>
                      {e.deltaPaise > 0 ? "+" : ""}{formatINR(paise(e.deltaPaise))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Glass>

      {/* All tiers reference */}
      <Glass>
        <div className="p-3">
          <h2 className="text-[12px] font-medium uppercase text-[var(--pc-text-tertiary)] mb-2">Tier ladder</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
            {DEFAULT_TIERS.map((t) => (
              <div key={t.tier} className={`p-2 rounded border border-[var(--pc-border-subtle)] ${tier.tier === t.tier ? "bg-[var(--pc-bg-hover)]" : ""}`}>
                <div className={`font-semibold ${tierColor[t.tier]}`}>{t.tier.toUpperCase()}</div>
                <div className="text-[var(--pc-text-tertiary)]">≥ {formatINR(t.minLifetimeSpendPaise)}</div>
                <div className="text-[var(--pc-text-secondary)]">{t.defaultDiscountPct}% off</div>
              </div>
            ))}
          </div>
        </div>
      </Glass>
    </div>
  );
}
