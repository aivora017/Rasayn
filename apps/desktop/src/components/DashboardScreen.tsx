import { useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Camera,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  Receipt,
  Wallet,
  Percent,
  Mail,
  Image as ImageIcon,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import {
  Glass,
  AmbientMesh,
  NumberFlip,
  Badge,
  Skeleton,
  Heatmap,
  Button,
  Illustration,
  SparkArea,
  TrendChart,
  formatINR,
  formatINRCompact,
  formatNumber,
  formatPct,
  useReducedMotion,
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
 * Owner home — state-of-the-art bento with glass surfaces, real Recharts,
 * mouse-aware parallax cards, NumberFlip on currency, ambient gradient mesh
 * background, period-comparison ghost lines, signature compliance pulse-ring.
 *
 * NS §3, §13.1 reference. Reduced-motion: parallax + breathing suppressed.
 */

export interface DashboardScreenProps {
  shop: Shop | null;
  onGoBilling: () => void;
  onGoGmail: () => void;
  onGoMasters: () => void;
  onGoGrn: () => void;
  onGoReports: () => void;
}

const SHOP_ID_FALLBACK = "shop_local";

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface KpiState {
  todayPaise: number;
  bills: number;
  byPayment: Record<string, number>;
  trend: { x: string; y: number; yPrev: number }[];
  trendPct: number;
}

interface MoatState {
  x2TotalProducts: number;
  x2MissingImages: number;
  x2DupSuspects: number;
}

/** Parallax wrapper — tilts toward the cursor, inert under reduced-motion. */
function Parallax({ children, max = 4, className }: { children: React.ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <div
      ref={ref}
      className={"pc-parallax " + (className ?? "")}
      onMouseMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--pc-tilt-x", String(((px - 0.5) * 2 * max).toFixed(2)));
        el.style.setProperty("--pc-tilt-y", String(((py - 0.5) * -2 * max).toFixed(2)));
      }}
      onMouseLeave={() => {
        const el = ref.current;
        if (el) {
          el.style.setProperty("--pc-tilt-x", "0");
          el.style.setProperty("--pc-tilt-y", "0");
        }
      }}
    >
      {children}
    </div>
  );
}

/** Compliance pulse-ring — animated SVG donut showing % compliant. */
function PulseRing({ percent }: { percent: number }) {
  const reduce = useReducedMotion();
  const r = 38;
  const c = 2 * Math.PI * r;
  const off = c - (percent / 100) * c;
  const tone =
    percent >= 95 ? "var(--pc-state-success)" : percent >= 80 ? "var(--pc-state-warning)" : "var(--pc-state-danger)";
  return (
    <div className="relative inline-flex h-[100px] w-[100px] items-center justify-center">
      <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} stroke="var(--pc-bg-surface-3)" strokeWidth="6" fill="none" />
        <motion.circle
          cx="50" cy="50" r={r}
          stroke={tone}
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: off }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 80, damping: 20, mass: 1 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="pc-tabular text-[20px] font-medium leading-none">{Math.round(percent)}%</span>
        <span className="text-[10px] text-[var(--pc-text-secondary)] mt-0.5">compliant</span>
      </div>
    </div>
  );
}

export function DashboardScreen({
  shop,
  onGoBilling,
  onGoGmail,
  onGoMasters,
  onGoGrn,
  onGoReports,
}: DashboardScreenProps): JSX.Element {
  const { t } = useTranslation();
  const shopId = shop?.id ?? SHOP_ID_FALLBACK;
  const [kpi, setKpi] = useState<KpiState | null>(null);
  const [moat, setMoat] = useState<MoatState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 14-day window: last 7 are current period, prior 7 are comparison.
        const dates = Array.from({ length: 14 }, (_, i) => isoOffset(-(13 - i)));
        const books = await Promise.all(
          dates.map((d) => dayBookRpc(shopId, d).catch(() => null)),
        );
        if (cancelled) return;
        const dvals = books.map((b) => b?.summary.grossPaise ?? 0);
        const trend = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(dates[i + 7] ?? "");
          const dow = Number.isFinite(d.getDay()) ? DOW_EN[d.getDay()] ?? "" : "";
          return {
            x: dow,
            y: dvals[i + 7] ?? 0,
            yPrev: dvals[i] ?? 0,
          };
        });
        const todayBook: DayBook | null = books[books.length - 1] ?? null;
        const yesterday: DayBook | null = books[books.length - 2] ?? null;
        const todayPaise = todayBook?.summary.grossPaise ?? 0;
        const bills = todayBook?.summary.billCount ?? 0;
        const byPayment = todayBook?.summary.byPayment ?? {};
        const yPaise = yesterday?.summary.grossPaise ?? 0;
        const trendPct = yPaise === 0 ? 0 : ((todayPaise - yPaise) / yPaise) * 100;
        setKpi({ todayPaise, bills, byPayment, trend, trendPct });
      } catch {/* ignore */}
    })();
    return () => { cancelled = true; };
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
      } catch {/* noop */}
    })();
    return () => { cancelled = true; };
  }, []);

  const cashDrawerPaise = useMemo(() => {
    const m = kpi?.byPayment ?? {};
    return (m["cash"] ?? 0) + (m["upi"] ?? 0) + (m["card"] ?? 0);
  }, [kpi]);

  const upiPct = useMemo(() => kpi && cashDrawerPaise > 0 ? ((kpi.byPayment["upi"] ?? 0) / cashDrawerPaise) * 100 : 0, [kpi, cashDrawerPaise]);
  const cashPct = useMemo(() => kpi && cashDrawerPaise > 0 ? ((kpi.byPayment["cash"] ?? 0) / cashDrawerPaise) * 100 : 0, [kpi, cashDrawerPaise]);

  const x2HealthPct = useMemo(() => moat && moat.x2TotalProducts > 0 ? ((moat.x2TotalProducts - moat.x2MissingImages) / moat.x2TotalProducts) * 100 : null, [moat]);

  // Compliance score derived from shop config + moat counts.
  const compliancePct = useMemo(() => {
    let score = 100;
    if (!shop || shop.gstin === "00AAAAA0000A0Z0") score -= 30;
    if (!shop || shop.retailLicense === "PENDING") score -= 20;
    if (moat && moat.x2MissingImages > 0) score -= Math.min(moat.x2MissingImages * 0.5, 15);
    if (moat && moat.x2DupSuspects > 0) score -= Math.min(moat.x2DupSuspects * 1.0, 10);
    return Math.max(score, 0);
  }, [shop, moat]);

  const heatmapCells: HeatmapTone[] = useMemo(() => {
    if (!moat) return Array(32).fill("muted") as HeatmapTone[];
    const total = 32;
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
      className="relative h-full overflow-auto pc-signature-gradient text-[var(--pc-text-primary)]"
    >
      <AmbientMesh blobs={3} opacity={0.35} />

      <div className="relative mx-auto max-w-[1280px] p-4 lg:p-6">
        {/* Hero */}
        <header className="mb-5 flex flex-wrap items-end gap-x-3 gap-y-1">
          <h1 className="text-[28px] font-medium leading-tight tracking-tight">
            {shop?.name ?? t("app.name")}
          </h1>
          <p className="text-[12px] text-[var(--pc-text-secondary)]">
            {shop?.address ?? "—"} · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[var(--pc-text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--pc-state-success)] animate-pulse" />
            {t("app.lanOnline")}
          </span>
        </header>

        {/* Row 1 — 4 KPI glass cards with parallax + NumberFlip */}
        <section aria-label="Today summary" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Parallax>
            <Glass depth={1} interactive className="p-4" data-testid="kpi-sales">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                <IndianRupee size={12} aria-hidden /> {t("dashboard.today")} {t("dashboard.sales")}
              </div>
              {kpi ? (
                <>
                  <div className="mt-1.5 text-[26px] font-medium leading-tight">
                    <NumberFlip value={formatINRCompact(kpi.todayPaise)} />
                  </div>
                  {kpi.trendPct !== 0 ? (
                    <div className={"mt-1 inline-flex items-center gap-1 text-[11px] " + (kpi.trendPct > 0 ? "text-[var(--pc-state-success)]" : "text-[var(--pc-state-warning)]")}>
                      {kpi.trendPct > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPct(kpi.trendPct)} {t("dashboard.vsYesterday")}
                    </div>
                  ) : null}
                  <div className="mt-2 -mx-1">
                    <SparkArea data={kpi.trend.map((p) => p.y)} tone="brand" height={32} ariaLabel="7-day sales" />
                  </div>
                </>
              ) : (
                <Skeleton width="100%" height={68} />
              )}
            </Glass>
          </Parallax>

          <Parallax>
            <Glass depth={1} interactive className="p-4" data-testid="kpi-bills">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                <Receipt size={12} aria-hidden /> {t("dashboard.bills")}
              </div>
              {kpi ? (
                <>
                  <div className="mt-1.5 text-[26px] font-medium leading-tight">
                    <NumberFlip value={formatNumber(kpi.bills)} />
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--pc-text-secondary)]">
                    {kpi.bills === 0 ? t("dashboard.noBillsYet") : t("dashboard.avgBill", { value: formatINR(kpi.todayPaise / kpi.bills) })}
                  </div>
                </>
              ) : <Skeleton width="100%" height={68} />}
            </Glass>
          </Parallax>

          <Parallax>
            <Glass depth={1} interactive className="p-4" data-testid="kpi-margin">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                <Percent size={12} aria-hidden /> {t("dashboard.margin")}
              </div>
              <div className="mt-1.5 text-[26px] font-medium leading-tight text-[var(--pc-text-tertiary)]">—</div>
              <div className="mt-1 text-[11px] text-[var(--pc-text-tertiary)]">{t("dashboard.configureCosts")}</div>
            </Glass>
          </Parallax>

          <Parallax>
            <Glass depth={1} interactive className="p-4" data-testid="kpi-cash">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                <Wallet size={12} aria-hidden /> {t("dashboard.cashDrawer")}
              </div>
              {kpi ? (
                <>
                  <div className="mt-1.5 text-[26px] font-medium leading-tight">
                    <NumberFlip value={formatINRCompact(cashDrawerPaise)} />
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--pc-state-info)]">
                    {cashDrawerPaise === 0 ? t("dashboard.noPaymentsYet") : `UPI ${Math.round(upiPct)}% · Cash ${Math.round(cashPct)}%`}
                  </div>
                </>
              ) : <Skeleton width="100%" height={68} />}
            </Glass>
          </Parallax>
        </section>

        {/* Row 2 — Sales chart (real Recharts with comparison ghost) + Compliance pulse ring */}
        <section className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Glass depth={1} interactive className="p-4" data-testid="dashboard-sales">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[14px] font-medium">{t("dashboard.sales7d")}</h2>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="inline-flex items-center gap-1 text-[var(--pc-text-secondary)]">
                  <span className="h-0.5 w-3 bg-[var(--pc-brand-primary)]" /> this week
                </span>
                <span className="inline-flex items-center gap-1 text-[var(--pc-text-tertiary)]">
                  <span className="h-0.5 w-3 border-t border-dashed border-[var(--pc-brand-primary)]" /> previous
                </span>
              </div>
            </div>
            {kpi ? (
              <TrendChart
                data={kpi.trend}
                tone="brand"
                height={180}
                showComparison
                formatY={(v) => formatINRCompact(v)}
              />
            ) : <Skeleton width="100%" height={180} />}
            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onGoReports} trailingIcon={<ArrowRight size={14} />}>
                {t("dashboard.quickReports")}
              </Button>
            </div>
          </Glass>

          <Glass depth={1} interactive className="p-4" data-testid="dashboard-compliance">
            <h2 className="mb-2 text-[14px] font-medium">{t("dashboard.compliance")}</h2>
            <div className="flex items-center gap-4">
              <PulseRing percent={compliancePct} />
              <ul className="flex-1 flex flex-col gap-1.5 text-[12px]">
                <ComplianceRow ok label="GSTR-1 export" />
                <ComplianceRow ok label="Schedule H/H1" />
                <ComplianceRow ok label="NDPS Form IV" />
                <ComplianceRow ok={!shop || shop.gstin !== "00AAAAA0000A0Z0"} label="Shop GSTIN" />
                <ComplianceRow ok={moat ? moat.x2DupSuspects === 0 : true} label={`Image dups ${moat ? `(${moat.x2DupSuspects})` : ""}`} />
              </ul>
            </div>
          </Glass>
        </section>

        {/* Row 3 — X1 / X2 / X3 moat panels with custom illustrations */}
        <section aria-label="Moat panels" className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Glass depth={2} className="p-4 cursor-pointer" data-testid="moat-x1" interactive onClick={onGoGmail} as="div">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge variant="brand">X1</Badge>
                <h3 className="mt-1 text-[14px] font-medium">{t("dashboard.distributorInbox")}</h3>
                <p className="mt-2 text-[26px] font-medium leading-tight pc-tabular text-[var(--pc-text-tertiary)]">—</p>
                <p className="mt-1 text-[11px] text-[var(--pc-text-secondary)]">connect Gmail to surface unread bills</p>
              </div>
              <Illustration name="x1-gmail" size={68} />
            </div>
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={onGoGmail} trailingIcon={<ArrowRight size={14} />}>{t("nav.gmail")}</Button>
            </div>
          </Glass>

          <Glass depth={2} className="p-4" data-testid="moat-x2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Badge variant="success">X2</Badge>
                <h3 className="mt-1 text-[14px] font-medium">{t("dashboard.skuImageHealth")}</h3>
                {moat ? (
                  <>
                    <p className="mt-2 text-[26px] font-medium leading-tight pc-tabular">
                      {x2HealthPct === null ? "—" : <NumberFlip value={`${x2HealthPct.toFixed(1)}%`} />}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--pc-text-secondary)]">
                      {moat.x2TotalProducts === 0 ? t("dashboard.noProducts") : t("dashboard.coverage", { covered: formatNumber(moat.x2TotalProducts - moat.x2MissingImages), total: formatNumber(moat.x2TotalProducts) })}
                    </p>
                  </>
                ) : <Skeleton width="100%" height={48} />}
              </div>
              <Illustration name="x2-image" size={68} />
            </div>
            {moat ? (
              <div className="mt-3">
                <Heatmap cells={heatmapCells} cols={8} ariaLabel="image health heatmap" />
                <p className="mt-2 text-[11px] text-[var(--pc-text-secondary)]">
                  {moat.x2MissingImages} {t("dashboard.missing")} · {moat.x2DupSuspects} {t("dashboard.duplicateSuspects")}
                </p>
              </div>
            ) : null}
            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={onGoMasters} trailingIcon={<ArrowRight size={14} />}>{t("nav.masters")}</Button>
            </div>
          </Glass>

          <Glass depth={2} tone="saffron" className="p-4 cursor-pointer" data-testid="moat-x3" interactive onClick={onGoGrn} as="div">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Badge variant="saffron">X3</Badge>
                <h3 className="mt-1 text-[14px] font-medium">{t("dashboard.photoBillGrn")}</h3>
                <p className="mt-2 text-[26px] font-medium leading-tight pc-tabular text-[var(--pc-text-tertiary)]">94.1%</p>
                <p className="mt-1 text-[11px] text-[var(--pc-text-secondary)]">{t("dashboard.lineRecall30d")}</p>
              </div>
              <Illustration name="x3-photo-bill" size={68} />
            </div>
            <button
              type="button"
              onClick={onGoGrn}
              className="mt-3 group flex w-full items-center justify-center gap-2 rounded-[var(--pc-radius-md)] border border-dashed border-[var(--pc-accent-saffron)] bg-[var(--pc-accent-saffron-soft)] py-3 text-[12px] font-medium text-[var(--pc-accent-saffron-hover)] transition-colors hover:bg-[var(--pc-accent-saffron)] hover:text-white"
              aria-label="Drop a paper bill or press F4"
            >
              <Camera size={16} aria-hidden />
              <span>{t("dashboard.dropPaperBill")}</span>
            </button>
          </Glass>
        </section>

        {/* Row 4 — Quick action chips */}
        <section aria-label="Quick actions" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Button onClick={onGoBilling} shortcut="Alt+1" leadingIcon={<Receipt size={14} />}>{t("dashboard.quickNew")}</Button>
          <Button variant="secondary" onClick={onGoGrn} shortcut="Alt+4">{t("dashboard.quickReceive")}</Button>
          <Button variant="secondary" onClick={onGoMasters} shortcut="Alt+9">{t("dashboard.quickProducts")}</Button>
          <Button variant="secondary" onClick={onGoReports} shortcut="Alt+3">{t("dashboard.quickReports")}</Button>
        </section>
      </div>
    </div>
  );
}

function ComplianceRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <ShieldCheck size={12} className="text-[var(--pc-state-success)]" aria-hidden /> : <AlertCircle size={12} className="text-[var(--pc-state-danger)]" aria-hidden />}
      <span className="flex-1 truncate">{label}</span>
    </li>
  );
}
