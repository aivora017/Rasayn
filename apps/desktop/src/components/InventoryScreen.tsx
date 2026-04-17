import { useEffect, useMemo, useState } from "react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
import { listStockRpc, type StockRow } from "../lib/ipc.js";
import { ReconcileTab } from "./inventory/ReconcileTab.js";

type Filter = "all" | "low" | "near" | "out" | "expired";
type TabKey = "batches" | "reconcile";

const NEAR_EXPIRY_DAYS = 90;
const LOW_STOCK_UNDER = 10;

export function InventoryScreen() {
  const [tab, setTab] = useState<TabKey>("batches");

  // Tab shortcuts: B = Batches, R = Reconcile (when focus isn't in an input).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const isTyping = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || (t as HTMLElement).isContentEditable);
      if (isTyping) return;
      if (e.key === "b" || e.key === "B") { setTab("batches"); }
      else if (e.key === "r" || e.key === "R") { setTab("reconcile"); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return (
    <div style={{ padding: 20 }} data-testid="inventory-screen">
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Inventory</h2>
        <div role="tablist" aria-label="Inventory tabs" style={{ display: "flex", gap: 4 }}>
          <TabButton active={tab === "batches"} onClick={() => setTab("batches")} testId="inv-tab-batches">
            Batches <kbd style={kbd}>B</kbd>
          </TabButton>
          <TabButton active={tab === "reconcile"} onClick={() => setTab("reconcile")} testId="inv-tab-reconcile">
            Reconcile <kbd style={kbd}>R</kbd>
          </TabButton>
        </div>
      </div>

      {tab === "batches" && <BatchesTab />}
      {tab === "reconcile" && <ReconcileTab />}
    </div>
  );
}

function TabButton({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      data-testid={testId}
      data-active={active}
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 4,
        border: "1px solid #cbd5e1",
        background: active ? "#0f172a" : "white",
        color: active ? "white" : "#0f172a",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

const kbd: React.CSSProperties = {
  background: "#e2e8f0", color: "#0f172a", padding: "0 4px", borderRadius: 2, fontSize: 10, marginLeft: 4, fontFamily: "monospace",
};

function BatchesTab() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<readonly StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    const opts: { q?: string; limit?: number } = { limit: 500 };
    const trimmed = q.trim();
    if (trimmed) opts.q = trimmed;
    listStockRpc(opts)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  const visible = useMemo(() => rows.filter((r) => {
    if (filter === "low")     return r.totalQty > 0 && r.totalQty <= LOW_STOCK_UNDER;
    if (filter === "near")    return r.daysToExpiry !== null && r.daysToExpiry <= NEAR_EXPIRY_DAYS;
    if (filter === "out")     return r.totalQty === 0;
    if (filter === "expired") return r.hasExpiredStock > 0;
    return true;
  }), [rows, filter]);

  const counts = useMemo(() => ({
    all:     rows.length,
    low:     rows.filter((r) => r.totalQty > 0 && r.totalQty <= LOW_STOCK_UNDER).length,
    near:    rows.filter((r) => r.daysToExpiry !== null && r.daysToExpiry <= NEAR_EXPIRY_DAYS).length,
    out:     rows.filter((r) => r.totalQty === 0).length,
    expired: rows.filter((r) => r.hasExpiredStock > 0).length,
  }), [rows]);

  return (
    <div data-testid="batches-tab">
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <input
          type="search"
          placeholder="Search by name or molecule…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="inv-search"
          style={{ flex: 1, padding: 8, border: "1px solid #cbd5e1", borderRadius: 4 }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }} data-testid="inv-filters">
        {(["all","low","near","out","expired"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            data-testid={`inv-filter-${f}`}
            data-active={filter === f}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #cbd5e1",
              background: filter === f ? "#0f172a" : "white",
              color: filter === f ? "white" : "#0f172a",
              cursor: "pointer",
              fontWeight: filter === f ? 600 : 400,
            }}
          >
            {labelFor(f)} <span style={{ opacity: 0.6 }}>({counts[f]})</span>
          </button>
        ))}
      </div>

      {err && <div data-testid="inv-err" style={{ color: "#dc2626", marginBottom: 8 }}>{err}</div>}
      {loading && <div data-testid="inv-loading" style={{ color: "#64748b" }}>Loading…</div>}

      <table data-testid="inv-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Product</th>
            <th>Sched</th>
            <th style={{ textAlign: "right" }}>Qty</th>
            <th>Batches</th>
            <th>FEFO Expiry</th>
            <th style={{ textAlign: "right" }}>MRP</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && !loading && (
            <tr><td colSpan={7} data-testid="inv-empty" style={{ padding: 24, textAlign: "center", color: "#64748b" }}>No rows.</td></tr>
          )}
          {visible.map((r) => (
            <tr key={r.productId} data-testid={`inv-row-${r.productId}`}>
              <td>
                <div><strong>{r.name}</strong></div>
                {r.genericName && <div style={{ fontSize: 12, color: "#64748b" }}>{r.genericName} · {r.manufacturer}</div>}
              </td>
              <td><SchedBadge schedule={r.schedule} /></td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} data-testid={`inv-qty-${r.productId}`}>
                {r.totalQty}
              </td>
              <td style={{ textAlign: "center" }}>{r.batchCount}</td>
              <td data-testid={`inv-expiry-${r.productId}`}>
                {r.nearestExpiry ?? <span style={{ color: "#94a3b8" }}>—</span>}
                {r.daysToExpiry !== null && (
                  <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>({r.daysToExpiry}d)</span>
                )}
              </td>
              <td style={{ textAlign: "right" }}>{formatINR(r.mrpPaise as Paise)}</td>
              <td data-testid={`inv-flags-${r.productId}`}><Flags row={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function labelFor(f: Filter): string {
  switch (f) {
    case "all":     return "All";
    case "low":     return "Low stock";
    case "near":    return `Near expiry (≤${NEAR_EXPIRY_DAYS}d)`;
    case "out":     return "Out of stock";
    case "expired": return "Expired on shelf";
  }
}

function Flags({ row }: { row: StockRow }) {
  const flags: Array<{ key: string; text: string; color: string }> = [];
  if (row.totalQty === 0) flags.push({ key: "out", text: "OUT", color: "#64748b" });
  else if (row.totalQty <= LOW_STOCK_UNDER) flags.push({ key: "low", text: "LOW", color: "#f59e0b" });
  if (row.daysToExpiry !== null && row.daysToExpiry <= 30) flags.push({ key: "near", text: "≤30d", color: "#dc2626" });
  else if (row.daysToExpiry !== null && row.daysToExpiry <= NEAR_EXPIRY_DAYS) flags.push({ key: "near", text: `≤${NEAR_EXPIRY_DAYS}d`, color: "#f59e0b" });
  if (row.hasExpiredStock > 0) flags.push({ key: "exp", text: `EXPIRED×${row.hasExpiredStock}`, color: "#7c2d12" });
  if (flags.length === 0) return <span style={{ color: "#94a3b8" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {flags.map((f) => (
        <span key={f.key} style={{ background: f.color, color: "white", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
          {f.text}
        </span>
      ))}
    </span>
  );
}

function SchedBadge({ schedule }: { schedule: StockRow["schedule"] }) {
  if (schedule === "OTC") return <span style={{ color: "#64748b", fontSize: 12 }}>OTC</span>;
  const color = schedule === "X" || schedule === "NDPS" ? "#7c2d12" : "#dc2626";
  return (
    <span style={{ background: color, color: "white", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
      {schedule}
    </span>
  );
}
