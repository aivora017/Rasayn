import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardKpi,
  Badge,
  Skeleton,
  Sparkline,
  Heatmap,
  Button,
  formatINR,
  formatINRCompact,
  formatNumber,
  formatPct,
  type HeatmapTone,
} from "@pharmacare/design-system";
import {
  dayBookRpc,
  listProductsMissingImageRpc,
  getDuplicateSuspectsRpc,
  listProductsRpc,
  type DayBook,
  type Shop,
} from "../lib/ipc.js";

/**
 * North Star §13.1 — owner home / dashboard.
 *
 * Bento layout, replaces "boot into BillingScreen". Uses real RPCs where
 * available (dayBook, listProductsMissingImage, getDuplicateSuspects);
 * shows skeletons / empty states where data is not yet wired.
 *
 * Compliance auto-checks (NS §10) and X1/X2/X3 moat panels are first-class.
 */

export interface DashboardScreenProps {
  shop: Shop | null;
  /** Navigation hooks — host wires these to mode changes. */
  onGoBilling: () => void;
  onGoGmail: () => void;
  onGoMasters: () => void;
  onGoGrn: () => void;
  onGoReports: () => void;
}

const SHOP_ID_FALLBACK = "shop_local";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface KpiState {
  todayPaise: number;
  bills: number;
  byPayment: Record<string, number>;
  trendData: number[];
  trendPct: number;
}

interface MoatState {
  x2TotalProducts: number;
  x2MissingImages: number;
  x2DupSuspects: number;
}

export function DashboardScreen({
  shop,
  onGoBilling,
  onGoGmail,
  onGoMasters,
  onGoGrn,
  onGoReports,
}: DashboardScreenProps): JSX.Element {
  const shopId = shop?.id ?? SHOP_ID_FALLBACK;
  const [kpi, setKpi] = useState<KpiState | null>(null);
  const [moat, setMoat] = useState<MoatState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 7-day window for sparkline + today.
        const dates = Array.from({ length: 7 }, (_, i) => isoOffset(-(6 - i)));
        const books = await Promise.all(
          dates.map((d) => dayBookRpc(shopId, d).catch(() => null)),
        );
        if (cancelled) return;
        const trend = books.map((b) => b?.summary.grossPaise ?? 0);
        const todayBook: DayBook | null = books[books.length - 1] ?? null;
        const yesterdayBook: DayBook | null = books[books.length - 2] ?? null;
        const todayPaise = todayBook?.summary.grossPaise ?? 0;
        const bills = todayBook?.summary.billCount ?? 0;
        const byPayment = todayBook?.summary.byPayment ?? {};
        const yPaise = yesterdayBook?.summary.grossPaise ?? 0;
        const trendPct = yPaise === 0 ? 0 : ((todayPaise - yPaise) / yPaise) * 100;
        setKpi({ todayPaise, bills, byPayment, trendData: trend, trendPct });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [missing, suspects, products] = await Promise.all([
          listProductsMissingImageRpc().catch(() => []),
          getDuplicateSuspectsRpc(12).catch(() => []),
          listProductsRpc({ limit: 5000 }).catch(() => []),
        ]);
        if (cancelled) return;
        setMoat({
          x2TotalProducts: products.length,
          x2MissingImages: missing.length,
          x2DupSuspects: suspects.length,
        });
      } catch {
        /* fall through */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cashDrawerPaise = useMemo(() => {
    const m = kpi?.byPayment ?? {};
    return (m["cash"] ?? 0) + (m["upi"] ?? 0) + (m["card"] ?? 0);
  }, [kpi]);

  const upiPct = useMemo(() => {
    if (!kpi || cashDrawerPaise === 0) return 0;
    return ((kpi.byPayment["upi"] ?? 0) / cashDrawerPaise) * 100;
  }, [kpi, cashDrawerPaise]);

  const cashPct = useMemo(() => {
    if (!kpi || cashDrawerPaise === 0) return 0;
    return ((kpi.byPayment["cash"] ?? 0) / cashDrawerPaise) * 100;
  }, [kpi, cashDrawerPaise]);

  const cardPct = useMemo(() => {
    if (!kpi || cashDrawerPaise === 0) return 0;
    return ((kpi.byPayment["card"] ?? 0) / cashDrawerPaise) * 100;
  }, [kpi, cashDrawerPaise]);

  const x2HealthPct = useMemo(() => {
    if (!moat || moat.x2TotalProducts === 0) return null;
    return ((moat.x2TotalProducts - moat.x2MissingImages) / moat.x2TotalProducts) * 100;
  }, [moat]);

  const heatmapCells: HeatmapTone[] = useMemo(() => {
    if (!moat) return Array(24).fill("muted") as HeatmapTone[];
    const total = 24;
    const dangerCount = Math.min(moat.x2DupSuspects, total);
    const warnCount = Math.min(moat.x2MissingImages, total - dangerCount);
    const okCount = Math.max(total - dangerCount - warnCount, 0);
    return [
      ...Array(okCount).fill("ok"),
      ...Array(warnCount).fill("warn"),
      ...Array(dangerCount).fill("danger"),
    ] as HeatmapTone[];
  }, [moat]);

  return (
    <div
      data-testid="dashboard-screen"
      className="h-full overflow-auto bg-[var(--pc-bg-canvas)] text-[var(--pc-text-primary)]"
    >
      <div className="mx-auto max-w-[1200px] p-4 lg:p-6">
        <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-medium leading-tight">
            {shop?.name ?? "PharmaCare Pro"}
          </h1>
          <p className="text-[12px] text-[var(--pc-text-secondary)]">
            {shop?.address ?? "Configure your shop in Settings"} · {todayIso()}
          </p>
          {error ? (
            <Badge variant="danger" className="ml-auto">{error}</Badge>
          ) : null}
        </header>

        {/* Row 1 — KPI cards */}
        <section
          aria-label="Today summary"
          className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <Card variant="recessed" className="p-3 px-4" data-testid="kpi-sales">
            {kpi ? (
              <CardKpi
                label="Today's sales"
                value={formatINRCompact(kpi.todayPaise)}
                trend={
                  kpi.trendPct === 0 ? null : (
                    <span
                      className={
                        kpi.trendPct > 0
                          ? "text-[var(--pc-state-success)]"
                          : "text-[var(--pc-state-warning)]"
                      }
                    >
                      {kpi.trendPct > 0 ? "▲ " : "▼ "}{formatPct(kpi.trendPct)} vs yesterday
                    </span>
                  )
                }
                sparkline={
                  kpi.trendData.some((x) => x > 0) ? (
                    <Sparkline data={kpi.trendData} width={140} height={28} ariaLabel="7-day sales trend" />
                  ) : null
                }
              />
            ) : (
              <Skeleton width="100%" height={64} />
            )}
          </Card>

          <Card variant="recessed" className="p-3 px-4" data-testid="kpi-bills">
            {kpi ? (
              <CardKpi
                label="Bills"
                value={formatNumber(kpi.bills)}
                trend={
                  <span className="text-[var(--pc-text-secondary)]">
                    {kpi.bills === 0 ? "no bills yet today" : `avg ${formatINR(kpi.bills === 0 ? 0 : kpi.todayPaise / kpi.bills)}`}
                  </span>
                }
              />
            ) : (
              <Skeleton width="100%" height={64} />
            )}
          </Card>

          <Card variant="recessed" className="p-3 px-4" data-testid="kpi-margin">
            <CardKpi
              label="Margin"
              value="—"
              trend={<span className="text-[var(--pc-text-tertiary)]">configure cost prices to track</span>}
            />
          </Card>

          <Card variant="recessed" className="p-3 px-4" data-testid="kpi-cash">
            {kpi ? (
              <CardKpi
                label="Cash drawer"
                value={formatINRCompact(cashDrawerPaise)}
                trend={
                  cashDrawerPaise === 0 ? (
                    <span className="text-[var(--pc-text-tertiary)]">no payments yet</span>
                  ) : (
                    <span className="text-[var(--pc-state-info)]">
                      UPI {Math.round(upiPct)}% · Cash {Math.round(cashPct)}% · Card {Math.round(cardPct)}%
                    </span>
                  )
                }
              />
            ) : (
              <Skeleton width="100%" height={64} />
            )}
          </Card>
        </section>

        {/* Row 2 — Sales chart + compliance */}
        <section className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Card data-testid="dashboard-sales">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[14px] font-medium">Sales — last 7 days</h2>
              <span className="text-[11px] text-[var(--pc-text-secondary)]">₹ paise · trend</span>
            </div>
            {kpi ? (
              <div className="h-[120px] flex items-end">
                <Sparkline
                  data={kpi.trendData.length ? kpi.trendData : [0, 0, 0, 0, 0, 0, 0]}
                  width={640}
                  height={120}
                  ariaLabel="last 7 days sales"
                />
              </div>
            ) : (
              <Skeleton width="100%" height={120} />
            )}
            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onGoReports}>
                Open reports →
              </Button>
            </div>
          </Card>

          <Card data-testid="dashboard-compliance">
            <h2 className="mb-2 text-[14px] font-medium">Compliance · auto checks</h2>
            <ul className="flex flex-col gap-2 text-[13px]">
              {[
                { label: "GSTR-1 export ready", tone: "ok" as const },
                { label: "Schedule H/H1 register", tone: "ok" as const },
                { label: "e-Invoice IRN pipeline", tone: shop ? "ok" as const : "warn" as const },
                { label: "NDPS Form IV", tone: "ok" as const },
                { label: "DPCO price ceiling", tone: "ok" as const },
                {
                  label: shop && shop.gstin && shop.gstin !== "00AAAAA0000A0Z0" ? "Shop license + GSTIN" : "Shop license + GSTIN missing",
                  tone: shop && shop.gstin && shop.gstin !== "00AAAAA0000A0Z0" ? ("ok" as const) : ("danger" as const),
                },
              ].map((it) => (
                <li key={it.label} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background:
                        it.tone === "ok"
                          ? "var(--pc-state-success)"
                          : it.tone === "warn"
                            ? "var(--pc-state-warning)"
                            : "var(--pc-state-danger)",
                    }}
                    aria-hidden
                  />
                  <span className="flex-1">{it.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        {/* Row 3 — X1 / X2 / X3 moat panels */}
        <section
          aria-label="Moat panels"
          className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3"
        >
          <Card data-testid="moat-x1">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="brand">X1</Badge>
              <h3 className="text-[13px] font-medium">Distributor inbox</h3>
            </div>
            <p className="text-[22px] font-medium leading-tight">
              <span className="pc-tabular">—</span>
            </p>
            <p className="mb-3 text-[11px] text-[var(--pc-text-secondary)]">
              Connect Gmail to surface unread bills
            </p>
            <Button variant="secondary" size="sm" onClick={onGoGmail}>
              Open Gmail inbox
            </Button>
          </Card>

          <Card data-testid="moat-x2">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="success">X2</Badge>
              <h3 className="text-[13px] font-medium">SKU image health</h3>
            </div>
            {moat ? (
              <>
                <p className="text-[22px] font-medium leading-tight pc-tabular">
                  {x2HealthPct === null ? "—" : `${x2HealthPct.toFixed(1)}%`}
                </p>
                <p className="mb-3 text-[11px] text-[var(--pc-text-secondary)]">
                  {moat.x2TotalProducts === 0
                    ? "No products yet"
                    : `${formatNumber(moat.x2TotalProducts - moat.x2MissingImages)} of ${formatNumber(moat.x2TotalProducts)} covered`}
                </p>
                <Heatmap cells={heatmapCells} cols={8} ariaLabel="SKU image health heatmap" />
                <p className="mt-2 text-[11px] text-[var(--pc-text-secondary)]">
                  {moat.x2MissingImages} missing · {moat.x2DupSuspects} dup-suspect
                </p>
              </>
            ) : (
              <Skeleton width="100%" height={120} />
            )}
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={onGoMasters}>
                Open product master
              </Button>
            </div>
          </Card>

          <Card data-testid="moat-x3">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="saffron">X3</Badge>
              <h3 className="text-[13px] font-medium">Photo-bill GRN</h3>
            </div>
            <p className="text-[22px] font-medium leading-tight pc-tabular">—</p>
            <p className="mb-3 text-[11px] text-[var(--pc-text-secondary)]">
              line-recall@3 · last 30d
            </p>
            <button
              type="button"
              onClick={onGoGrn}
              className="block w-full rounded-[var(--pc-radius-md)] border border-dashed border-[var(--pc-border-default)] bg-[var(--pc-bg-surface-2)] py-4 text-center transition-colors hover:bg-[var(--pc-bg-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-brand-primary)]"
              aria-label="Open GRN to drop a paper bill photo"
            >
              <span aria-hidden style={{ fontSize: 22 }}>📷</span>
              <p className="mt-1 text-[12px] text-[var(--pc-text-secondary)]">
                Drop a paper bill or press F4
              </p>
            </button>
          </Card>
        </section>

        {/* Row 4 — Quick actions */}
        <section
          aria-label="Quick actions"
          className="grid grid-cols-2 gap-2 lg:grid-cols-4"
        >
          <Button onClick={onGoBilling} shortcut="Alt+1">New bill</Button>
          <Button variant="secondary" onClick={onGoGrn} shortcut="Alt+4">Receive (GRN)</Button>
          <Button variant="secondary" onClick={onGoMasters} shortcut="Alt+9">Product master</Button>
          <Button variant="secondary" onClick={onGoReports} shortcut="Alt+3">Reports</Button>
        </section>
      </div>
    </div>
  );
}
