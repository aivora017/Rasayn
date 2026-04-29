// DemandForecastTab — reorder recommendations + churn nudges.
// Real Prophet/LSTM training is deferred — this UI consumes the engine's
// types so it slots in once Python training infra exists.
import { useMemo, useState } from "react";
import { LineChart as IconChart, ShoppingCart, ArrowRight, AlertTriangle } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import { paise, formatINR } from "@pharmacare/shared-types";
import { scoreCustomer, type CustomerPurchase } from "@pharmacare/churn-prediction";

interface ReorderRow {
  productId: string;
  productName: string;
  currentStock: number;
  reorderPoint: number;
  recommendedQty: number;
  estCostPaise: number;
  suggestedDistributor: string;
  daysOfCoverLeft: number;
}

const SAMPLE_REORDERS: ReorderRow[] = [
  { productId: "p1", productName: "Crocin 500mg",        currentStock:  20, reorderPoint:  60, recommendedQty: 100, estCostPaise: 70_00, suggestedDistributor: "Pharmarack",  daysOfCoverLeft: 4 },
  { productId: "p2", productName: "Metformin 500mg",     currentStock:  35, reorderPoint:  80, recommendedQty: 120, estCostPaise: 84_00, suggestedDistributor: "Retailio",    daysOfCoverLeft: 7 },
  { productId: "p3", productName: "Amoxicillin 500mg",   currentStock:   8, reorderPoint:  40, recommendedQty:  80, estCostPaise: 96_00, suggestedDistributor: "Pharmarack",  daysOfCoverLeft: 2 },
  { productId: "p4", productName: "Atorvastatin 10mg",   currentStock:  60, reorderPoint:  50, recommendedQty:   0, estCostPaise:     0, suggestedDistributor: "—",            daysOfCoverLeft: 14 },
];

const DEMO_CUSTOMERS: { customerId: string; purchases: CustomerPurchase[] }[] = [
  { customerId: "c_priya",
    purchases: [
      { customerId: "c_priya", billedAt: "2026-01-15", amountPaise: paise(80000), hasRefillableItems: true },
      { customerId: "c_priya", billedAt: "2026-02-15", amountPaise: paise(85000), hasRefillableItems: true },
      { customerId: "c_priya", billedAt: "2026-03-15", amountPaise: paise(82000), hasRefillableItems: true },
    ] },
  { customerId: "c_rahul",
    purchases: [
      { customerId: "c_rahul", billedAt: "2025-08-01", amountPaise: paise(40000), hasRefillableItems: true },
      { customerId: "c_rahul", billedAt: "2025-09-01", amountPaise: paise(45000), hasRefillableItems: true },
    ] },
];

export default function DemandForecastTab(): React.ReactElement {
  const [tab, setTab] = useState<"reorder" | "refill">("reorder");
  const churn = useMemo(() => DEMO_CUSTOMERS.map((c) => scoreCustomer({
    customerId: c.customerId, purchases: c.purchases, nowIso: "2026-04-28T12:00:00Z",
  })).sort((a, b) => b.score - a.score), []);

  const totalReorderCost = SAMPLE_REORDERS.reduce((s, r) => s + r.estCostPaise, 0);
  const urgent = SAMPLE_REORDERS.filter((r) => r.daysOfCoverLeft < 5).length;

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="demand-forecast">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IconChart size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Demand Forecast & Refills</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Reorder recommendations · churn-driven refill nudges
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant={tab === "reorder" ? "default" : "ghost"} onClick={() => setTab("reorder")}>Reorder ({SAMPLE_REORDERS.filter((r) => r.recommendedQty > 0).length})</Button>
          <Button variant={tab === "refill"  ? "default" : "ghost"} onClick={() => setTab("refill")}>Refill nudges ({churn.filter((c) => c.recommendedActionTemplate).length})</Button>
        </div>
      </header>

      {urgent > 0 && (
        <Glass>
          <div className="p-3 flex items-start gap-2 text-[12px] text-[var(--pc-state-warning)]">
            <AlertTriangle size={14} className="mt-0.5" />
            <strong>{urgent}</strong> SKU{urgent === 1 ? "" : "s"} have less than 5 days of cover — order today.
          </div>
        </Glass>
      )}

      {tab === "reorder" && (
        <Glass>
          <div className="p-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Product</th>
                  <th className="py-2 font-medium text-right">Stock</th>
                  <th className="py-2 font-medium text-right">ROP</th>
                  <th className="py-2 font-medium text-right">Days cover</th>
                  <th className="py-2 font-medium text-right">Order qty</th>
                  <th className="py-2 font-medium text-right">Est cost</th>
                  <th className="py-2 font-medium">Distributor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_REORDERS.map((r) => (
                  <tr key={r.productId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2 font-medium">{r.productName}</td>
                    <td className="py-2 font-mono tabular-nums text-right">{r.currentStock}</td>
                    <td className="py-2 font-mono tabular-nums text-right">{r.reorderPoint}</td>
                    <td className="py-2 text-right">
                      <Badge variant={r.daysOfCoverLeft < 5 ? "danger" : r.daysOfCoverLeft < 10 ? "warning" : "success"}>
                        {r.daysOfCoverLeft}d
                      </Badge>
                    </td>
                    <td className="py-2 font-mono tabular-nums text-right">{r.recommendedQty || "—"}</td>
                    <td className="py-2 font-mono tabular-nums text-right">{r.recommendedQty > 0 ? formatINR(paise(r.estCostPaise)) : "—"}</td>
                    <td className="py-2">{r.suggestedDistributor}</td>
                    <td className="py-2 text-right">
                      {r.recommendedQty > 0 && <Button variant="ghost"><ShoppingCart size={12} /> Draft PO</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--pc-border-subtle)]">
                  <td colSpan={5} className="py-2 font-medium">Total estimated PO cost</td>
                  <td className="py-2 font-mono tabular-nums text-right">{formatINR(paise(totalReorderCost))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Glass>
      )}

      {tab === "refill" && (
        <Glass>
          <div className="p-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium text-right">Days since</th>
                  <th className="py-2 font-medium text-right">Cadence</th>
                  <th className="py-2 font-medium">RFM</th>
                  <th className="py-2 font-medium">Score</th>
                  <th className="py-2 font-medium">Action</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {churn.map((c) => (
                  <tr key={c.customerId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2 font-mono">{c.customerId}</td>
                    <td className="py-2 font-mono tabular-nums text-right">{c.daysSinceLastPurchase}d</td>
                    <td className="py-2 font-mono tabular-nums text-right">{c.typicalCadenceDays ?? "—"}d</td>
                    <td className="py-2 font-mono">R{c.rfmBuckets.recencyBucket}F{c.rfmBuckets.frequencyBucket}M{c.rfmBuckets.monetaryBucket}</td>
                    <td className="py-2">
                      <Badge variant={c.score > 0.7 ? "danger" : c.score > 0.5 ? "warning" : "success"}>
                        {Math.round(c.score * 100)}%
                      </Badge>
                    </td>
                    <td className="py-2 text-[var(--pc-text-secondary)] font-mono text-[11px]">{c.recommendedActionTemplate ?? "—"}</td>
                    <td className="py-2 text-right">
                      {c.recommendedActionTemplate && <Button variant="ghost"><ArrowRight size={12} /> Send</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Glass>
      )}
    </div>
  );
}
