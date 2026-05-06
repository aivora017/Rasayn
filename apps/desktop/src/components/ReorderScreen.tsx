// ReorderScreen — Auto-PO suggestions per supplier.
//
// S26 Wave 2 Agent B — replaced the S12 mocks (MOCK_STOCK / MOCK_SUPPLIERS /
// MOCK_FORECASTS) with real `list_reorder_suggestions` IPC reads. The S13
// "replace with IPC calls" comment is finally resolved.
//
// Suggestions are computed Rust-side and grouped by urgency:
//   high (red) = critical | high  (out-of-stock or below-safety horizon)
//   med  (amber)= medium            (within safety + lead time)
//   low  (green)= normal            (healthy, included only for visibility)

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Download, AlertTriangle, RefreshCw, Filter, Boxes, Send } from "lucide-react";
import { Glass, Badge, Button, Skeleton, useToast } from "@pharmacare/design-system";
import {
  listReorderSuggestionsRpc,
  type ReorderSuggestionDTO,
} from "../lib/ipc.js";

type UrgencyBand = "high" | "med" | "low";

function urgencyBand(u: ReorderSuggestionDTO["urgency"]): UrgencyBand {
  if (u === "critical" || u === "high") return "high";
  if (u === "normal") return "low";
  return "med"; // future "medium" tier — keep deterministic
}

const HORIZON_PRESETS = [7, 14, 30, 60] as const;

interface Props {
  readonly shopId?: string;
}

export function ReorderScreen({ shopId = "shop_local" }: Props = {}): JSX.Element {
  const { toast } = useToast();
  const [horizonDays, setHorizonDays] = useState<number>(14);
  const [rows, setRows] = useState<readonly ReorderSuggestionDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await listReorderSuggestionsRpc({ shopId, horizonDays });
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load reorder suggestions: ${String(e)}`);
          setRows([]);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [shopId, horizonDays, refreshKey]);

  const grouped = useMemo(() => {
    const high: ReorderSuggestionDTO[] = [];
    const med: ReorderSuggestionDTO[] = [];
    const low: ReorderSuggestionDTO[] = [];
    for (const r of rows ?? []) {
      const band = urgencyBand(r.urgency);
      if (band === "high") high.push(r);
      else if (band === "med") med.push(r);
      else low.push(r);
    }
    return { high, med, low };
  }, [rows]);

  const totalValue = useMemo(
    () => (rows ?? []).reduce((acc, r) => acc + r.suggestValuePaise, 0),
    [rows],
  );

  const toggleSelect = useCallback((productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const generatePoDraft = useCallback(() => {
    const lines = (rows ?? []).filter((r) => selected.has(r.productId));
    if (lines.length === 0) {
      toast({ variant: "info", title: "Select rows first", description: "Tick at least one suggestion to draft a PO." });
      return;
    }
    const totalPaise = lines.reduce((acc, l) => acc + l.suggestValuePaise, 0);
    // Stub: actual PO write is deferred to a follow-up sprint. We emit a toast
    // showing the would-be draft so the owner sees feedback.
    toast({
      variant: "success",
      title: `PO draft prepared (${lines.length} SKUs)`,
      description: `Total ₹${(totalPaise / 100).toLocaleString("en-IN")}. Persist-PO follow-up sprint will wire this to save_po.`,
    });
  }, [rows, selected, toast]);

  const sectionRowToBadge = (u: UrgencyBand) =>
    u === "high" ? "danger" : u === "med" ? "warning" : "success";

  const renderSection = (band: UrgencyBand, label: string, list: readonly ReorderSuggestionDTO[]) => {
    if (list.length === 0) return null;
    return (
      <Glass key={band}>
        <div style={{ padding: 12 }} data-testid={`reorder-section-${band}`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge variant={sectionRowToBadge(band)}>{label}</Badge>
              <span style={{ fontSize: 12, color: "var(--pc-text-secondary)" }}>{list.length} SKUs</span>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--pc-border-subtle)" }}>
                <th style={{ padding: 6 }}>{/* checkbox */}</th>
                <th style={{ padding: 6 }}>SKU</th>
                <th style={{ padding: 6 }}>Product</th>
                <th style={{ padding: 6 }}>Supplier</th>
                <th style={{ padding: 6, textAlign: "right" }}>On hand</th>
                <th style={{ padding: 6, textAlign: "right" }}>Need</th>
                <th style={{ padding: 6, textAlign: "right" }}>Days left</th>
                <th style={{ padding: 6, textAlign: "right" }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr
                  key={l.productId}
                  data-testid={`reorder-row-${l.productId}`}
                  data-urgency-band={band}
                  style={{
                    borderBottom: "1px solid var(--pc-border-subtle)",
                    background: band === "high"
                      ? "color-mix(in srgb, var(--pc-state-danger-bg) 40%, transparent)"
                      : undefined,
                  }}
                >
                  <td style={{ padding: 6 }}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${l.productName}`}
                      checked={selected.has(l.productId)}
                      onChange={() => toggleSelect(l.productId)}
                    />
                  </td>
                  <td style={{ padding: 6, fontFamily: "monospace" }}>{l.skuCode}</td>
                  <td style={{ padding: 6 }}>{l.productName}</td>
                  <td style={{ padding: 6 }}>{l.supplierName}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{l.onHandUnits}</td>
                  <td style={{ padding: 6, textAlign: "right", fontWeight: 600 }}>{l.suggestQtyUnits}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{l.daysOfStockLeft}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>₹{(l.suggestValuePaise / 100).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Glass>
    );
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }} data-screen="reorder">
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
            <Package size={28} />
            Auto Reorder
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--pc-text-secondary)" }}>
            Suggested purchase orders from current stock + demand forecast (next {horizonDays} days).
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => setRefreshKey((k) => k + 1)} data-testid="reorder-refresh">
            <RefreshCw size={16} /> Refresh
          </Button>
          <Button onClick={generatePoDraft} data-testid="reorder-generate-po">
            <Send size={14} /> Generate PO Draft
          </Button>
        </div>
      </header>

      {error && (
        <Glass>
          <div style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--pc-state-danger)" }} data-testid="reorder-error">
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <AlertTriangle size={14} /> {error}
            </span>
            <Button variant="ghost" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshCw size={12} /> Retry
            </Button>
          </div>
        </Glass>
      )}

      <Glass>
        <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={14} /> Horizon (days):
            <input
              type="range"
              min={7}
              max={60}
              step={1}
              value={horizonDays}
              onChange={(e) => setHorizonDays(Math.max(1, Math.min(120, Number(e.target.value) || 14)))}
              data-testid="reorder-horizon-slider"
              aria-label="Horizon days"
              style={{ width: 160 }}
            />
            <span style={{ fontFamily: "monospace", minWidth: 24 }} data-testid="reorder-horizon-value">{horizonDays}</span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {HORIZON_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setHorizonDays(d)}
                  data-testid={`reorder-horizon-preset-${d}`}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 6,
                    border: horizonDays === d ? "2px solid var(--pc-brand-primary)" : "1px solid var(--pc-border-subtle)",
                    background: horizonDays === d ? "var(--pc-brand-primary-soft)" : "transparent",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >{d}</button>
              ))}
            </span>
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
            <Badge variant={grouped.high.length > 0 ? "danger" : "neutral"}>
              {grouped.high.length} high
            </Badge>
            <Badge variant={grouped.med.length > 0 ? "warning" : "neutral"}>
              {grouped.med.length} med
            </Badge>
            <Badge variant="success">{grouped.low.length} low</Badge>
            <Badge variant="info">
              ₹{(totalValue / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} total
            </Badge>
          </div>
        </div>
      </Glass>

      {loading ? (
        <Glass>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }} data-testid="reorder-loading">
            <Skeleton width="100%" height={32} />
            <Skeleton width="100%" height={28} />
            <Skeleton width="100%" height={28} />
          </div>
        </Glass>
      ) : (rows ?? []).length === 0 && !error ? (
        <Glass>
          <div style={{ padding: 24, textAlign: "center", color: "var(--pc-text-secondary)" }} data-testid="reorder-empty">
            <Boxes size={48} style={{ opacity: 0.3 }} />
            <p style={{ marginTop: 8, fontSize: 14, fontWeight: 500 }}>No reorders needed</p>
            <p style={{ fontSize: 12 }}>
              Stock levels look healthy across the next {horizonDays} days.
            </p>
            <Button variant="ghost" onClick={() => setRefreshKey((k) => k + 1)} style={{ marginTop: 12 }}>
              <RefreshCw size={12} /> Re-check
            </Button>
          </div>
        </Glass>
      ) : (
        <>
          {renderSection("high", "High urgency",  grouped.high)}
          {renderSection("med",  "Medium urgency", grouped.med)}
          {renderSection("low",  "Low urgency",    grouped.low)}
          <Glass>
            <div style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--pc-text-secondary)" }}>
                {selected.size} of {(rows ?? []).length} selected for PO
              </span>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                <Download size={12} /> Clear selection
              </Button>
            </div>
          </Glass>
        </>
      )}
    </div>
  );
}
