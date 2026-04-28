// X2a + X2b: Compliance dashboard.
//
// Owner uses this to spot Schedule H/H1/X products that bypassed the X2 image
// gate (legacy imports, mock-migrations) AND visually-similar duplicates flagged
// by perceptual hash distance. Uploads happen in Product Master.
//
// X2b (ADR 0019) thresholds (inclusive):
//   distance ≤ 6   → near-duplicate (high-confidence, danger highlight)
//   distance 7-12  → suspicious     (review, warning highlight)
//
// NS §13.11 — promoted from a list to a real dashboard with KPI cards, heatmap,
// and tokenized tables. All existing data-testid surfaces preserved 1:1.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardKpi,
  Badge,
  Heatmap,
  Skeleton,
  formatNumber,
  type HeatmapTone,
} from "@pharmacare/design-system";
import { ShieldCheck, ShieldX, Image as ImageIcon, TriangleAlert } from "lucide-react";
import {
  listProductsMissingImageRpc,
  getDuplicateSuspectsRpc,
  type MissingImageRowDTO,
  type DuplicateSuspectRowDTO,
} from "../lib/ipc.js";

const SUSPECT_MAX_DISTANCE = 12;
const NEAR_DUPLICATE_THRESHOLD = 6;

type State =
  | { kind: "loading" }
  | {
      kind: "ready";
      rows: readonly MissingImageRowDTO[];
      suspects: readonly DuplicateSuspectRowDTO[];
    }
  | { kind: "error"; message: string };

function suspectSeverity(distance: number): "near-duplicate" | "suspicious" {
  return distance <= NEAR_DUPLICATE_THRESHOLD ? "near-duplicate" : "suspicious";
}

export function ComplianceDashboard(): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [rows, suspects] = await Promise.all([
        listProductsMissingImageRpc(),
        getDuplicateSuspectsRpc(SUSPECT_MAX_DISTANCE),
      ]);
      setState({ kind: "ready", rows, suspects });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Heatmap mock — once real product totals are wired, switch to actual ratio.
  const heatmapCells = useMemo<HeatmapTone[]>(() => {
    if (state.kind !== "ready") return [];
    const total = 32;
    const dangerCount = Math.min(
      state.suspects.filter((s) => s.distance <= NEAR_DUPLICATE_THRESHOLD).length,
      total,
    );
    const warnCount = Math.min(state.rows.length, total - dangerCount);
    const okCount = Math.max(total - dangerCount - warnCount, 0);
    return [
      ...Array(okCount).fill("ok"),
      ...Array(warnCount).fill("warn"),
      ...Array(dangerCount).fill("danger"),
    ] as HeatmapTone[];
  }, [state]);

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-[1200px] p-4 lg:p-6" data-testid="cd-loading">
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} variant="recessed" className="p-3 px-4">
              <Skeleton width="100%" height={56} />
            </Card>
          ))}
        </div>
        <Card>
          <Skeleton width="100%" height={240} />
        </Card>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-[1200px] p-4 lg:p-6">
        <Card>
          <div className="flex items-start gap-3">
            <TriangleAlert size={20} aria-hidden style={{ color: "var(--pc-state-danger)" }} />
            <div className="flex-1">
              <h2 className="text-[16px] font-medium text-[var(--pc-state-danger)]">
                Compliance report failed
              </h2>
              <p data-testid="cd-error" role="alert" className="mt-1 text-[13px] text-[var(--pc-text-secondary)]">
                {state.message}
              </p>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void refresh()}
                  data-testid="cd-refresh"
                >
                  Refresh
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const { rows, suspects } = state;
  const blockerCount = rows.filter((r) => r.severity === "blocker").length;
  const warningCount = rows.filter((r) => r.severity === "warning").length;
  const nearDupCount = suspects.filter((s) => s.distance <= NEAR_DUPLICATE_THRESHOLD).length;
  const suspiciousCount = suspects.length - nearDupCount;
  const allClean = rows.length === 0 && suspects.length === 0;

  return (
    <div className="mx-auto max-w-[1200px] p-4 lg:p-6 text-[var(--pc-text-primary)]">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight">Compliance · X2 image health</h1>
        <p className="text-[12px] text-[var(--pc-text-secondary)]">
          Schedule H/H1/X gate audit + perceptual-hash duplicate detection
        </p>
        <div className="ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            data-testid="cd-refresh"
          >
            Refresh
          </Button>
        </div>
      </header>

      {/* KPI cards */}
      <section
        aria-label="Compliance KPIs"
        className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <Card variant="recessed" className="p-3 px-4">
          <CardKpi
            label="Hard blockers"
            value={
              <span style={{ color: blockerCount > 0 ? "var(--pc-state-danger)" : "var(--pc-state-success)" }}>
                {formatNumber(blockerCount)}
              </span>
            }
            trend={
              <span className="text-[var(--pc-text-secondary)]">
                Schedule H/H1/X without image
              </span>
            }
          />
        </Card>
        <Card variant="recessed" className="p-3 px-4">
          <CardKpi
            label="Warnings"
            value={formatNumber(warningCount)}
            trend={
              <span className="text-[var(--pc-text-secondary)]">
                non-Rx products without image
              </span>
            }
          />
        </Card>
        <Card variant="recessed" className="p-3 px-4">
          <CardKpi
            label="Near-duplicates"
            value={
              <span style={{ color: nearDupCount > 0 ? "var(--pc-state-danger)" : "var(--pc-state-success)" }}>
                {formatNumber(nearDupCount)}
              </span>
            }
            trend={
              <span className="text-[var(--pc-text-secondary)]">distance ≤ 6 — likely mis-attached</span>
            }
          />
        </Card>
        <Card variant="recessed" className="p-3 px-4">
          <CardKpi
            label="Suspicious"
            value={formatNumber(suspiciousCount)}
            trend={
              <span className="text-[var(--pc-text-secondary)]">distance 7-12 — review</span>
            }
          />
        </Card>
      </section>

      {/* Heatmap snapshot */}
      <section
        aria-label="Image health snapshot"
        className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_2fr]"
      >
        <Card>
          <h2 className="mb-2 text-[14px] font-medium">Image health snapshot</h2>
          {heatmapCells.length > 0 ? (
            <Heatmap cells={heatmapCells} cols={8} ariaLabel="Image health heatmap" />
          ) : (
            <Skeleton width="100%" height={88} />
          )}
          <p className="mt-2 text-[11px] text-[var(--pc-text-secondary)]">
            ok · warning · blocker
          </p>
        </Card>
        <Card variant="brand">
          <div className="flex items-start gap-3">
            <ShieldCheck size={20} aria-hidden />
            <div className="flex-1">
              <h2 className="text-[14px] font-medium">Why this matters</h2>
              <p className="mt-1 text-[12px] leading-relaxed">
                Schedule H, H1, and X drugs cannot legally be billed without a verified product
                identity. The X2 gate enforces an image at point-of-sale; this dashboard surfaces
                products that bypassed it (legacy imports, mock-migrations) and visually
                near-identical pairs that may indicate a mis-attached image.
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* Missing-image section */}
      <section data-testid="cd-missing-section" className="mb-4">
        <Card>
          <header className="mb-3 flex items-center gap-2">
            <ImageIcon size={16} aria-hidden style={{ color: "var(--pc-state-warning)" }} />
            <h2 className="text-[14px] font-medium">Products missing images</h2>
            {rows.length > 0 ? (
              <Badge variant={blockerCount > 0 ? "danger" : "warning"} className="ml-auto">
                {blockerCount > 0 ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}` : `${rows.length} to review`}
              </Badge>
            ) : (
              <Badge variant="success" className="ml-auto">all covered</Badge>
            )}
          </header>
          {rows.length === 0 ? (
            <div
              data-testid="cd-empty"
              className="rounded-[var(--pc-radius-md)] border border-dashed border-[var(--pc-state-success)] bg-[var(--pc-state-success-bg)] px-4 py-6 text-center text-[13px] text-[var(--pc-state-success)]"
            >
              All products have images.
            </div>
          ) : (
            <>
              <div data-testid="cd-summary" className="mb-2 text-[12px] text-[var(--pc-text-secondary)]">
                {rows.length} products missing images — {blockerCount} blockers (Schedule H/H1/X), {warningCount} warnings
              </div>
              <div className="overflow-auto">
                <table data-testid="cd-table" className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Severity</th>
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Schedule</th>
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Name</th>
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Manufacturer</th>
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Product ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.productId}
                        className={r.severity === "blocker" ? "row-blocker" : "row-warning"}
                        style={{
                          background:
                            r.severity === "blocker"
                              ? "var(--pc-state-danger-bg)"
                              : "transparent",
                        }}
                        data-testid={`cd-row-${r.productId}`}
                      >
                        <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3">
                          {r.severity === "blocker" ? (
                            <Badge variant="danger">{r.severity}</Badge>
                          ) : (
                            <Badge variant="warning">{r.severity}</Badge>
                          )}
                        </td>
                        <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3">{r.schedule}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3">{r.name}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 text-[var(--pc-text-secondary)]">
                          {r.manufacturer}
                        </td>
                        <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-mono text-[12px] text-[var(--pc-text-tertiary)]">
                          {r.productId}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </section>

      {/* Duplicate suspects */}
      <section data-testid="cd-suspects-section" className="mb-4">
        <Card>
          <header className="mb-3 flex items-center gap-2">
            <ShieldX size={16} aria-hidden style={{ color: "var(--pc-state-warning)" }} />
            <h3 className="text-[14px] font-medium">Duplicate suspects (image pHash)</h3>
            {suspects.length > 0 ? (
              <Badge variant={nearDupCount > 0 ? "danger" : "warning"} className="ml-auto">
                {suspects.length} pair{suspects.length === 1 ? "" : "s"}
              </Badge>
            ) : (
              <Badge variant="success" className="ml-auto">no suspects</Badge>
            )}
          </header>
          {suspects.length === 0 ? (
            <div
              data-testid="cd-suspects-empty"
              className="rounded-[var(--pc-radius-md)] border border-dashed border-[var(--pc-state-success)] bg-[var(--pc-state-success-bg)] px-4 py-6 text-center text-[13px] text-[var(--pc-state-success)]"
            >
              No visually-similar product pairs detected.
            </div>
          ) : (
            <>
              <div data-testid="cd-suspects-summary" className="mb-2 text-[12px] text-[var(--pc-text-secondary)]">
                {suspects.length} suspect pair{suspects.length === 1 ? "" : "s"} — {nearDupCount} near-duplicate, {suspiciousCount} suspicious
              </div>
              <div className="overflow-auto">
                <table data-testid="cd-suspects-table" className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Severity</th>
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Distance</th>
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Product A</th>
                      <th className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 font-medium">Product B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suspects.map((s) => {
                      const sev = suspectSeverity(s.distance);
                      const key = `${s.productIdA}__${s.productIdB}`;
                      return (
                        <tr
                          key={key}
                          className={sev === "near-duplicate" ? "row-near-duplicate" : "row-suspicious"}
                          style={{
                            background:
                              sev === "near-duplicate"
                                ? "var(--pc-state-danger-bg)"
                                : "transparent",
                          }}
                          data-testid={`cd-suspect-${key}`}
                        >
                          <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3">
                            {sev === "near-duplicate" ? (
                              <Badge variant="danger">{sev}</Badge>
                            ) : (
                              <Badge variant="warning">{sev}</Badge>
                            )}
                          </td>
                          <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3 pc-tabular">
                            {s.distance}
                          </td>
                          <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3">
                            {s.nameA}{" "}
                            <span className="muted text-[11px] font-mono text-[var(--pc-text-tertiary)]">
                              ({s.productIdA})
                            </span>
                          </td>
                          <td className="border-b border-[var(--pc-border-subtle)] py-2 pr-3">
                            {s.nameB}{" "}
                            <span className="muted text-[11px] font-mono text-[var(--pc-text-tertiary)]">
                              ({s.productIdB})
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </section>

      {allClean ? (
        <Card variant="brand" className="text-center">
          <div className="flex items-center justify-center gap-2">
            <ShieldCheck size={20} aria-hidden />
            <span className="text-[14px] font-medium">All compliance checks passing.</span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default ComplianceDashboard;
