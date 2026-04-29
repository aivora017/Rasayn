// ReorderScreen — Auto-PO suggestions per supplier (S12).
//
// Consumes @pharmacare/reorder-suggest. Stock + forecasts come from
// existing IPC; for now we use mocked data so the screen is shippable
// without a forecasts table migration.

import { useMemo, useState, useCallback, useEffect } from "react";
import { Package, Download, AlertTriangle, RefreshCw, Filter, Boxes } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  computeSuggestions, groupBySupplier, buildPORows,
  type StockSnapshot, type SupplierProfile, type DemandForecast,
} from "@pharmacare/reorder-suggest";
import { listStockRpc, listSuppliersRpc, topMoversRpc } from "../lib/ipc.js";

// Mock data for S12 — replace with IPC calls in S13.
const MOCK_STOCK: StockSnapshot[] = [
  { productId: "p1", productName: "Paracetamol 500mg", skuCode: "PCM500",
    preferredSupplierId: "sup1", onHandUnits: 30, avgCostPaise: 120, safetyStockUnits: 50 },
  { productId: "p2", productName: "Crocin Advance", skuCode: "CRC500",
    preferredSupplierId: "sup1", onHandUnits: 200, avgCostPaise: 280, safetyStockUnits: 50 },
  { productId: "p3", productName: "Insulin (NovoMix)", skuCode: "INS-N",
    preferredSupplierId: "sup2", onHandUnits: 5, avgCostPaise: 45_000, safetyStockUnits: 10 },
  { productId: "p4", productName: "Amoxicillin 500mg", skuCode: "AMX500",
    preferredSupplierId: "sup1", onHandUnits: 40, avgCostPaise: 380, safetyStockUnits: 30 },
];

const MOCK_SUPPLIERS: SupplierProfile[] = [
  { supplierId: "sup1", supplierName: "Bharat Pharma Distributors",
    leadTimeDays: 3, minOrderValuePaise: 50_000_00,
    moqByProductId: { p1: 100, p4: 50 } },
  { supplierId: "sup2", supplierName: "Cipla Direct",
    leadTimeDays: 5, minOrderValuePaise: 10_000_00,
    moqByProductId: {} },
];

const MOCK_FORECASTS: DemandForecast[] = [
  { productId: "p1", dailyUnits: Array(30).fill(12) },
  { productId: "p2", dailyUnits: Array(30).fill(2) },
  { productId: "p3", dailyUnits: Array(30).fill(1) },
  { productId: "p4", dailyUnits: Array(30).fill(8) },
];

type UrgencyFilter = "all" | "critical" | "high";

export function ReorderScreen(): JSX.Element {
  const [safetyDays, setSafetyDays] = useState(7);
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [stocks, setStocks]       = useState<StockSnapshot[]>(MOCK_STOCK);
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>(MOCK_SUPPLIERS);
  const [forecasts, setForecasts] = useState<DemandForecast[]>(MOCK_FORECASTS);
  const [liveErr, setLiveErr]     = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [stockRows, supRows] = await Promise.all([
          listStockRpc(),
          listSuppliersRpc("shop_local"),
        ]);
        const liveStocks: StockSnapshot[] = stockRows.map((r) => ({
          productId: r.productId,
          productName: r.name,
          skuCode: r.productId,
          preferredSupplierId: supRows[0]?.id ?? "sup_unknown",
          onHandUnits: r.totalQty,
          avgCostPaise: Math.max(1, Math.round(r.mrpPaise * 0.7)),
          safetyStockUnits: Math.max(10, Math.ceil(r.totalQty * 0.2)),
        }));
        const liveSuppliers: SupplierProfile[] = supRows.map((s) => ({
          supplierId: s.id, supplierName: s.name,
          leadTimeDays: 3, minOrderValuePaise: 50_000_00, moqByProductId: {},
        }));
        // Demand forecast: 30 days flat from average daily movement (top_movers)
        let liveForecasts: DemandForecast[] = liveStocks.map((s) => ({
          productId: s.productId,
          dailyUnits: Array(30).fill(Math.max(1, Math.round(s.onHandUnits / 14))),
        }));
        try {
          const today = new Date();
          const from = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
          const to   = today.toISOString().slice(0, 10);
          const movers = await topMoversRpc("shop_local", from, to, 200);
          const moverMap = new Map(movers.map((m) => [m.productId, m.qtySold]));
          liveForecasts = liveStocks.map((s) => {
            const sold = moverMap.get(s.productId) ?? 0;
            const daily = Math.max(1, Math.round(sold / 30));
            return { productId: s.productId, dailyUnits: Array(30).fill(daily) };
          });
        } catch {
          // top_movers failure is non-fatal — keep flat forecast
        }
        if (liveStocks.length > 0) setStocks(liveStocks);
        if (liveSuppliers.length > 0) setSuppliers(liveSuppliers);
        setForecasts(liveForecasts);
        setLiveErr(null);
      } catch (e) {
        setLiveErr(`Live data unavailable; showing demo data. ${String(e)}`);
      }
    })();
  }, [refreshKey]);

  const suggestions = useMemo(() => {
    return computeSuggestions({
      stocks, suppliers, forecasts,
      safetyDaysExtra: safetyDays,
    });
  }, [safetyDays, stocks, suppliers, forecasts]);

  const filtered = useMemo(() => {
    if (urgencyFilter === "all") return suggestions;
    return suggestions.filter((s) =>
      urgencyFilter === "critical" ? s.urgency === "critical"
        : s.urgency === "critical" || s.urgency === "high",
    );
  }, [suggestions, urgencyFilter]);

  const groups = useMemo(() => groupBySupplier(filtered, suppliers), [filtered, suppliers]);

  const exportPoCsv = useCallback((groupId: string) => {
    const group = groups.find((g) => g.supplierId === groupId);
    if (!group) return;
    const rows = buildPORows(group);
    const csv = [
      "SKU,Product,Qty,Rate (₹),Amount (₹)",
      ...rows.map((r) =>
        `${r.skuCode},"${r.productName.replace(/"/g, '""')}",${r.qty},${r.rateRupees.toFixed(2)},${r.amountRupees.toFixed(2)}`,
      ),
      `,,,Total,${(group.totalValuePaise / 100).toFixed(2)}`,
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PO-${group.supplierName.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [groups]);

  const totalCriticalCount = suggestions.filter((s) => s.urgency === "critical").length;
  const totalValue = suggestions.reduce((acc, s) => acc + s.suggestValuePaise, 0);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
            <Package size={28} />
            Auto Reorder
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)" }}>
            Suggested purchase orders from current stock + 30-day demand forecast.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </header>

      {liveErr && (
        <Glass>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
            <AlertTriangle size={14} /> <span style={{ fontSize: 12 }}>{liveErr}</span>
          </div>
        </Glass>
      )}

      <Glass>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Safety days:
            <input
              type="number"
              min={0}
              max={30}
              value={safetyDays}
              onChange={(e) => setSafetyDays(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
              style={{ width: 60, padding: 4 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <Filter size={16} />
            {(["all", "high", "critical"] as UrgencyFilter[]).map((u) => (
              <button
                key={u}
                onClick={() => setUrgencyFilter(u)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 8,
                  border: urgencyFilter === u ? "2px solid var(--brand-primary)" : "1px solid var(--border)",
                  background: urgencyFilter === u ? "var(--brand-primary-soft)" : "transparent",
                  cursor: "pointer",
                }}
              >
                {u}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
            <Badge variant={totalCriticalCount > 0 ? "danger" : "neutral"}>
              {totalCriticalCount} critical
            </Badge>
            <Badge variant="info">
              ₹{(totalValue / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} total
            </Badge>
          </div>
        </div>
      </Glass>

      {groups.length === 0 ? (
        <Glass>
          <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
            <Boxes size={48} style={{ opacity: 0.3 }} />
            <p>No reorders suggested. Stock levels look healthy for the next {safetyDays + 3} days.</p>
          </div>
        </Glass>
      ) : (
        groups.map((g) => (
          <Glass key={g.supplierId}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{g.supplierName}</h3>
                <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
                  Lead time {g.leadTimeDays} days · {g.lines.length} SKUs · ₹{(g.totalValuePaise / 100).toLocaleString("en-IN")}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {!g.meetsMinOrderValue && (
                  <Badge variant="warning">
                    <AlertTriangle size={12} /> Below min-order value
                  </Badge>
                )}
                <Button onClick={() => exportPoCsv(g.supplierId)}>
                  <Download size={16} /> Export PO CSV
                </Button>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: 8 }}>SKU</th>
                  <th style={{ padding: 8 }}>Product</th>
                  <th style={{ padding: 8, textAlign: "right" }}>On hand</th>
                  <th style={{ padding: 8, textAlign: "right" }}>Need</th>
                  <th style={{ padding: 8, textAlign: "right" }}>Days left</th>
                  <th style={{ padding: 8 }}>Urgency</th>
                  <th style={{ padding: 8, textAlign: "right" }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.productId} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: 8, fontFamily: "monospace" }}>{l.skuCode}</td>
                    <td style={{ padding: 8 }}>{l.productName}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>{l.onHandUnits}</td>
                    <td style={{ padding: 8, textAlign: "right", fontWeight: 600 }}>{l.suggestQtyUnits}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>{l.daysOfStockLeft}</td>
                    <td style={{ padding: 8 }}>
                      <Badge variant={l.urgency === "critical" ? "danger" : l.urgency === "high" ? "warning" : "neutral"}>
                        {l.urgency}
                      </Badge>
                    </td>
                    <td style={{ padding: 8, textAlign: "right" }}>₹{(l.suggestValuePaise / 100).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Glass>
        ))
      )}
    </div>
  );
}
