// FraudAlertCard — drop-in for ComplianceDashboard. Lists fraud-detection
// alerts with narrative text + drill-down into evidence bills.
import { useMemo, useState } from "react";
import { ShieldAlert, ChevronDown, ChevronUp, FileSearch } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  detectAnomalies, DEFAULT_THRESHOLDS,
  type FraudAlert, type BillFeature, type RefundFeature, type ShopHours,
} from "@pharmacare/fraud-detection";
import { paise } from "@pharmacare/shared-types";

const DEMO_HOURS: ShopHours = { openTime: "09:00", closeTime: "21:00" };

const DEMO_BILLS: BillFeature[] = [
  // user u1 — high discount averages 12% across 12 bills
  ...Array.from({ length: 12 }, (_, i) => ({
    billId: `b_demo_u1_${i}`, billNo: `B-${100 + i}`, userId: "u1",
    billedAt: `2026-04-${15 + (i % 10)}T14:00:00Z`,
    grandTotalPaise: paise(8800), discountPaise: paise(1200), subtotalPaise: paise(10000),
    voided: false, schedXLineCount: 0,
  })),
  // user u2 — 4 voids
  ...Array.from({ length: 4 }, (_, i) => ({
    billId: `b_demo_u2_${i}`, billNo: `B-${200 + i}`, userId: "u2",
    billedAt: `2026-04-2${i}T15:00:00Z`,
    grandTotalPaise: paise(50000), discountPaise: paise(0), subtotalPaise: paise(50000),
    voided: true, schedXLineCount: 0,
  })),
  // user u3 — after-hours bill at 5am
  { billId: "b_demo_u3_5am", billNo: "B-300", userId: "u3",
    billedAt: "2026-04-26T05:00:00Z",
    grandTotalPaise: paise(20000), discountPaise: paise(0), subtotalPaise: paise(20000),
    voided: false, schedXLineCount: 0 },
];

const DEMO_REFUNDS: RefundFeature[] = [
  { returnId: "r1", originalBillId: "b_dup", userId: "u1", refundedAt: "2026-04-20T11:00:00Z", refundPaise: paise(2500) },
  { returnId: "r2", originalBillId: "b_dup", userId: "u1", refundedAt: "2026-04-20T15:00:00Z", refundPaise: paise(2500) },
];

export default function FraudAlertCard(): React.ReactElement {
  const alerts = useMemo<readonly FraudAlert[]>(() => detectAnomalies({
    shopId: "shop_local", bills: DEMO_BILLS, refunds: DEMO_REFUNDS,
    hours: DEMO_HOURS, thresholds: DEFAULT_THRESHOLDS,
  }), []);

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Glass>
      <div className="p-4 flex flex-col gap-3" data-testid="fraud-alerts-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className={alerts.length > 0 ? "text-[var(--pc-state-danger)]" : ""} aria-hidden />
            <h2 className="font-medium">Fraud anomalies — last 30 days</h2>
          </div>
          <Badge variant={alerts.length > 0 ? "danger" : "success"}>
            {alerts.length} alert{alerts.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {alerts.length === 0 ? (
          <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
            No anomalies detected in this window.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => {
              const open = expanded === a.id;
              return (
                <li key={a.id} className="rounded border border-[var(--pc-border-subtle)] p-3 text-[13px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="danger">{a.category}</Badge>
                      <span className="text-[var(--pc-text-secondary)]">user <span className="font-mono">{a.userId}</span></span>
                      <Badge variant="neutral">score {Math.round(a.score * 100)}%</Badge>
                    </div>
                    <Button variant="ghost" onClick={() => setExpanded(open ? null : a.id)}>
                      {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? "Hide" : "Show"} details
                    </Button>
                  </div>
                  {open && (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="text-[12px]">{a.narrative}</div>
                      <div className="text-[11px] text-[var(--pc-text-tertiary)]">
                        Window: {new Date(a.windowStart).toLocaleString("en-IN")} → {new Date(a.windowEnd).toLocaleString("en-IN")}
                      </div>
                      <div className="text-[11px] flex flex-wrap items-center gap-1">
                        <FileSearch size={11} />
                        Evidence ({a.evidenceBillIds.length}):
                        {a.evidenceBillIds.slice(0, 8).map((id) => (
                          <span key={id} className="font-mono px-1.5 py-0.5 rounded bg-[var(--pc-bg-surface)] border border-[var(--pc-border-subtle)]">{id}</span>
                        ))}
                        {a.evidenceBillIds.length > 8 && <span>+{a.evidenceBillIds.length - 8} more</span>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Glass>
  );
}
