import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Search, Filter as FilterIcon, AlertCircle } from "lucide-react";
import { Glass, Badge, Skeleton, Input, formatINR as fmtINR } from "@pharmacare/design-system";
import { type Paise } from "@pharmacare/shared-types";
import { listStockRpc, type StockRow } from "../lib/ipc.js";
import { ReconcileTab } from "./inventory/ReconcileTab.js";

/**
 * Inventory — sticky-header dense table with semantic chips, glass tabs,
 * filter chips with counts, and tokenized empty/loading/error states.
 */

type Filter = "all" | "low" | "near" | "out" | "expired";
type TabKey = "batches" | "reconcile";

const NEAR_EXPIRY_DAYS = 90;
const LOW_STOCK_UNDER = 10;

export function InventoryScreen() {
  const [tab, setTab] = useState<TabKey>("batches");

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
    <div className="mx-auto max-w-[1280px] p-4 lg:p-6 text-[var(--pc-text-primary)]" data-testid="inventory-screen">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight">Inventory</h1>
        <div role="tablist" aria-label="Inventory tabs" className="ml-auto flex items-center gap-0.5 rounded-[var(--pc-radius-md)] bg-[var(--pc-bg-surface-2)] p-0.5">
          <TabButton active={tab === "batches"} onClick={() => setTab("batches")} testId="inv-tab-batches">
            Batches <kbd className="ml-1 rounded-[var(--pc-radius-sm)] bg-[var(--pc-bg-surface)] px-1 py-0.5 text-[10px] text-[var(--pc-text-secondary)] font-mono">B</kbd>
          </TabButton>
          <TabButton active={tab === "reconcile"} onClick={() => setTab("reconcile")} testId="inv-tab-reconcile">
            Reconcile <kbd className="ml-1 rounded-[var(--pc-radius-sm)] bg-[var(--pc-bg-surface)] px-1 py-0.5 text-[10px] text-[var(--pc-text-secondary)] font-mono">R</kbd>
          </TabButton>
        </div>
      </header>

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
      className={
        "rounded-[var(--pc-radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors " +
        (active
          ? "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)] shadow-[var(--pc-elevation-1)]"
          : "text-[var(--pc-text-secondary)] hover:text-[var(--pc-text-primary)]")
      }
    >
      {children}
    </button>
  );
}

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
    <div data-testid="batches-tab" className="flex flex-col gap-3">
      {/* Toolbar — search + filter chips */}
      <Glass depth={1} className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <Input
            inputSize="md"
            type="search"
            placeholder="Search by name or molecule…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="inv-search"
            leading={<Search size={14} />}
            className="flex-1"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="inv-filters">
          <FilterIcon size={14} className="text-[var(--pc-text-tertiary)]" />
          {(["all","low","near","out","expired"] as const).map((f) => (
            <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)} testId={`inv-filter-${f}`} count={counts[f]}>
              {labelFor(f)}
            </FilterChip>
          ))}
        </div>
      </Glass>

      {err && (
        <div data-testid="inv-err" className="flex items-center gap-2 rounded-[var(--pc-radius-md)] border border-[var(--pc-state-danger)] bg-[var(--pc-state-danger-bg)] px-3 py-2 text-[12px] text-[var(--pc-state-danger)]">
          <AlertCircle size={14} aria-hidden /> {err}
        </div>
      )}

      <Glass depth={1} className="p-0 overflow-hidden">
        {loading && rows.length === 0 ? (
          <div data-testid="inv-loading" className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} width="100%" height={28} />)}
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table data-testid="inv-table" className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 bg-[color-mix(in_oklab,var(--pc-bg-surface-2)_92%,transparent)] backdrop-blur z-10">
                <tr className="text-left text-[10px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                  <th className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-medium">Product</th>
                  <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">Sched</th>
                  <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Qty</th>
                  <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-center">Batches</th>
                  <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">FEFO Expiry</th>
                  <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">MRP</th>
                  <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} data-testid="inv-empty" className="px-3 py-12 text-center text-[12px] text-[var(--pc-text-secondary)]">
                      No rows.
                    </td>
                  </tr>
                )}
                {visible.map((r) => (
                  <tr key={r.productId} data-testid={`inv-row-${r.productId}`} className="hover:bg-[var(--pc-bg-surface-2)] transition-colors">
                    <td className="border-b border-[var(--pc-border-subtle)] px-3 py-2 align-top">
                      <div className="font-medium leading-tight">{r.name}</div>
                      {r.genericName && (
                        <div className="text-[11px] text-[var(--pc-text-secondary)] mt-0.5">
                          {r.genericName} · {r.manufacturer}
                        </div>
                      )}
                    </td>
                    <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 align-top">
                      <SchedBadge schedule={r.schedule} />
                    </td>
                    <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 align-top text-right pc-tabular" data-testid={`inv-qty-${r.productId}`}>
                      <span style={qtyStyle(r)}>{r.totalQty}</span>
                    </td>
                    <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 align-top text-center pc-tabular text-[var(--pc-text-secondary)]">
                      {r.batchCount}
                    </td>
                    <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 align-top" data-testid={`inv-expiry-${r.productId}`}>
                      {r.nearestExpiry ? (
                        <div className="flex items-center gap-1.5">
                          <span className="pc-tabular text-[12px]">{r.nearestExpiry}</span>
                          {r.daysToExpiry !== null && <ExpiryChip days={r.daysToExpiry} />}
                        </div>
                      ) : <span className="text-[var(--pc-text-tertiary)]">—</span>}
                    </td>
                    <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 align-top text-right pc-tabular">
                      {fmtINR(r.mrpPaise as Paise)}
                    </td>
                    <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 align-top" data-testid={`inv-flags-${r.productId}`}>
                      <Flags row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Glass>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  testId,
  count,
}: { active: boolean; onClick: () => void; children: React.ReactNode; testId: string; count: number }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      data-active={active}
      className={
        "inline-flex items-center gap-1.5 rounded-[var(--pc-radius-pill)] px-2.5 py-1 text-[11px] font-medium transition-colors " +
        (active
          ? "bg-[var(--pc-brand-primary)] text-white"
          : "bg-[var(--pc-bg-surface-2)] text-[var(--pc-text-secondary)] hover:bg-[var(--pc-bg-surface-3)] hover:text-[var(--pc-text-primary)]")
      }
    >
      {children}
      <span className={"pc-tabular " + (active ? "opacity-80" : "opacity-60")}>{count}</span>
    </button>
  );
}

function qtyStyle(r: StockRow): CSSProperties {
  if (r.totalQty === 0) return { color: "var(--pc-text-tertiary)" };
  if (r.totalQty <= LOW_STOCK_UNDER) return { color: "var(--pc-state-warning)", fontWeight: 500 };
  return {};
}

function ExpiryChip({ days }: { days: number }) {
  if (days <= 0) return <Badge variant="danger">expired</Badge>;
  if (days <= 30) return <Badge variant="danger">{days}d</Badge>;
  if (days <= NEAR_EXPIRY_DAYS) return <Badge variant="warning">{days}d</Badge>;
  return <span className="text-[10px] text-[var(--pc-text-tertiary)]">{days}d</span>;
}

function labelFor(f: Filter): string {
  switch (f) {
    case "all":     return "All";
    case "low":     return "Low";
    case "near":    return `≤${NEAR_EXPIRY_DAYS}d`;
    case "out":     return "Out";
    case "expired": return "Expired";
  }
}

function Flags({ row }: { row: StockRow }) {
  const out: JSX.Element[] = [];
  if (row.totalQty === 0) out.push(<Badge key="out" variant="neutral">OUT</Badge>);
  else if (row.totalQty <= LOW_STOCK_UNDER) out.push(<Badge key="low" variant="warning">LOW</Badge>);
  if (row.daysToExpiry !== null && row.daysToExpiry <= 30) out.push(<Badge key="d30" variant="danger">≤30d</Badge>);
  else if (row.daysToExpiry !== null && row.daysToExpiry <= NEAR_EXPIRY_DAYS) out.push(<Badge key="d90" variant="warning">≤{NEAR_EXPIRY_DAYS}d</Badge>);
  if (row.hasExpiredStock > 0) out.push(<Badge key="exp" variant="warning">EXPIRED×{row.hasExpiredStock}</Badge>);
  if (out.length === 0) return <span className="text-[var(--pc-text-tertiary)]">—</span>;
  return <span className="inline-flex flex-wrap gap-1">{out}</span>;
}

function SchedBadge({ schedule }: { schedule: StockRow["schedule"] }) {
  if (schedule === "OTC") return <span className="text-[11px] text-[var(--pc-text-secondary)]">OTC</span>;
  const variant = schedule === "X" || schedule === "NDPS" ? "warning" : "danger";
  return <Badge variant={variant}>{schedule}</Badge>;
}
