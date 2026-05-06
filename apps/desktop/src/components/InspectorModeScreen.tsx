// InspectorModeScreen — single-tap FDA inspector report.
//
// S26 Wave 2 Agent B — replaced the `Array.from({length: 47})` demo
// fabrication (line ~35) with real `list_schedule_register` IPC reads. The
// month-to-date counters now reflect actual dispenses; the inspector
// report builder still composes the multi-section bundle from the same
// real rows. NPPA/IRN/expired-stock sections remain stubbed as zero arrays
// for now — those become real reads when Agent A ships their respective
// commands.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, AlertTriangle, CheckCircle2, Download, FileText, RefreshCw } from "lucide-react";
import { Glass, Badge, Button, Skeleton, useToast } from "@pharmacare/design-system";
import { paise, formatINR } from "@pharmacare/shared-types";
import {
  buildInspectorReport, renderInspectorReportMarkdown,
  type InspectorReport, type ScheduleHRow, type ScheduleXRow,
} from "@pharmacare/inspector-mode";
import {
  listScheduleRegisterRpc,
  type ScheduleRegisterRowDTO,
} from "../lib/ipc.js";

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function monthBounds(today: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

interface Props {
  readonly shopId?: string;
  readonly today?: Date;
}

interface Aggregate {
  readonly h: number;
  readonly h1: number;
  readonly x: number;
  readonly total: number;
  readonly flagsRaised: number;
  readonly recent: readonly ScheduleRegisterRowDTO[];
  readonly raw: readonly ScheduleRegisterRowDTO[];
}

function aggregate(rows: readonly ScheduleRegisterRowDTO[]): Aggregate {
  let h = 0, h1 = 0, x = 0, flagsRaised = 0;
  for (const r of rows) {
    if (r.schedule === "H") h += 1;
    else if (r.schedule === "H1") h1 += 1;
    else if (r.schedule === "X") x += 1;
    if (!r.rxImage) flagsRaised += 1;
    if (r.schedule === "X" && !r.witnessName) flagsRaised += 1;
  }
  const recent = [...rows]
    .sort((a, b) => b.billedAt.localeCompare(a.billedAt))
    .slice(0, 5);
  return { h, h1, x, total: h + h1 + x, flagsRaised, recent, raw: rows };
}

function toScheduleRows(rows: readonly ScheduleRegisterRowDTO[]): {
  schedH: readonly ScheduleHRow[];
  schedX: readonly ScheduleXRow[];
} {
  const schedH: ScheduleHRow[] = [];
  const schedX: ScheduleXRow[] = [];
  for (const r of rows) {
    const base: ScheduleHRow = {
      billId: r.billId, billNo: r.billNo, billedAt: r.billedAt,
      customerName: r.customerName, doctorName: r.doctorName, doctorRegNo: r.doctorRegNo,
      drugName: r.drug, batchNo: r.batchNo, qty: r.qty,
      rxImagePath: r.rxImage ? `rx/${r.billId}.jpg` : undefined,
    };
    if (r.schedule === "X") {
      schedX.push({ ...base, witnessUserId: "u_witness", witnessName: r.witnessName ?? "(missing)" });
    } else if (r.schedule === "H" || r.schedule === "H1") {
      schedH.push(base);
    }
  }
  return { schedH, schedX };
}

export default function InspectorModeScreen({ shopId = "shop_local", today }: Props = {}): React.ReactElement {
  const { toast } = useToast();
  const now = today ?? new Date();
  const bounds = useMemo(() => monthBounds(now), [now]);

  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<InspectorReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const rows = await listScheduleRegisterRpc({
          periodStartIso: bounds.start,
          periodEndIso: bounds.end,
          schedule: "all",
          shopId,
        });
        if (!cancelled) {
          setAgg(aggregate(rows));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load Schedule register: ${String(e)}`);
          setAgg(aggregate([]));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [bounds.start, bounds.end, shopId, refreshKey]);

  const generate = useCallback(() => {
    if (!agg) return;
    setBusy(true);
    try {
      const { schedH, schedX } = toScheduleRows(agg.raw);
      const r = buildInspectorReport({
        shopId,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        generatedAt: new Date().toISOString(),
        generatedByUserId: "u_owner",
        schedHRows: schedH,
        schedXRows: schedX,
        ndpsRows: [],
        irnRows: [],
        nppaRows: [],
        expiredRows: [],
        counselingSummary: { bills_with_counseling: agg.total, bills_requiring_counseling: agg.total },
      });
      setReport(r);
    } finally { setBusy(false); }
  }, [agg, shopId, bounds.start, bounds.end]);

  const exportMd = useCallback(() => {
    if (!report) return;
    downloadBlob(`inspector_${report.periodStart}_${report.periodEnd}.md`,
      renderInspectorReportMarkdown(report), "text/markdown");
    toast({ variant: "success", title: "Markdown exported" });
  }, [report, toast]);

  const exportJson = useCallback(() => {
    if (!report) return;
    downloadBlob(`inspector_${report.periodStart}_${report.periodEnd}.json`,
      JSON.stringify(report, null, 2), "application/json");
    toast({ variant: "success", title: "JSON exported" });
  }, [report, toast]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="inspector-mode">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Inspector Mode</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Single-tap compliance bundle for FDA / Drug Inspector visits. Period {bounds.start} → {bounds.end}.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setRefreshKey((k) => k + 1)} data-testid="inspector-refresh">
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button onClick={generate} disabled={busy || loading || !agg}>
            <FileText size={14} /> {busy ? "Generating…" : report ? "Re-generate" : "Generate report"}
          </Button>
        </div>
      </header>

      {error && (
        <Glass>
          <div className="p-3 flex items-center justify-between gap-2 text-[var(--pc-state-danger)]" data-testid="inspector-error">
            <span className="flex items-center gap-2 text-[12px]">
              <AlertTriangle size={14} /> {error}
            </span>
            <Button variant="ghost" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshCw size={12} /> Retry
            </Button>
          </div>
        </Glass>
      )}

      {loading ? (
        <Glass>
          <div className="p-6 flex flex-col gap-2" data-testid="inspector-loading">
            <Skeleton width="100%" height={28} />
            <Skeleton width="100%" height={88} />
            <Skeleton width="100%" height={88} />
          </div>
        </Glass>
      ) : agg && agg.total === 0 ? (
        <Glass>
          <div className="p-6 flex flex-col items-center gap-2 text-[var(--pc-text-secondary)]" data-testid="inspector-empty">
            <Eye size={32} className="text-[var(--pc-brand-primary)]" />
            <p className="text-[14px] font-medium">No Schedule dispenses in this period</p>
            <p className="text-[12px]">Period {bounds.start} → {bounds.end} has zero H / H1 / X bills. Nothing to report.</p>
          </div>
        </Glass>
      ) : agg && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="inspector-counts">
          <Glass>
            <div className="p-4">
              <p className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Schedule H</p>
              <p className="text-[28px] font-semibold tabular-nums" data-testid="count-h">{agg.h}</p>
            </div>
          </Glass>
          <Glass>
            <div className="p-4">
              <p className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Schedule H1</p>
              <p className="text-[28px] font-semibold tabular-nums" data-testid="count-h1">{agg.h1}</p>
            </div>
          </Glass>
          <Glass>
            <div className="p-4">
              <p className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Schedule X</p>
              <p className="text-[28px] font-semibold tabular-nums" data-testid="count-x">{agg.x}</p>
            </div>
          </Glass>
          <Glass>
            <div className="p-4 md:col-span-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium">Compliance flags raised</p>
                <Badge variant={agg.flagsRaised > 0 ? "danger" : "success"} data-testid="count-flags">
                  {agg.flagsRaised}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--pc-text-tertiary)] mt-1">
                Counts entries missing Rx image + Schedule-X dispenses without a witness.
              </p>
            </div>
          </Glass>
          {agg.recent.length > 0 && (
            <Glass>
              <div className="p-4 md:col-span-3">
                <h3 className="font-medium text-[13px] mb-2">Recent inspector-relevant events</h3>
                <table className="w-full text-[12px]" data-testid="inspector-recent">
                  <thead>
                    <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px]">
                      <th className="py-1 font-medium">Bill</th>
                      <th className="py-1 font-medium">Date</th>
                      <th className="py-1 font-medium">Sched</th>
                      <th className="py-1 font-medium">Drug</th>
                      <th className="py-1 font-medium">Customer</th>
                      <th className="py-1 font-medium text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agg.recent.map((r) => (
                      <tr key={r.billId} className="border-t border-[var(--pc-border-subtle)]">
                        <td className="py-1 font-mono">{r.billNo}</td>
                        <td className="py-1">{r.billedAt}</td>
                        <td className="py-1">
                          <Badge variant={r.schedule === "X" ? "danger" : r.schedule === "H1" ? "warning" : "info"}>{r.schedule}</Badge>
                        </td>
                        <td className="py-1">{r.drug}</td>
                        <td className="py-1">{r.customerName}</td>
                        <td className="py-1 font-mono tabular-nums text-right">{r.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Glass>
          )}
        </div>
      )}

      {report && (
        <>
          <Glass>
            <div className="p-4 flex items-start gap-3">
              {report.summary.redFlags.length === 0
                ? <CheckCircle2 size={24} className="text-[var(--pc-state-success)] mt-1" />
                : <AlertTriangle size={24} className="text-[var(--pc-state-danger)] mt-1" />}
              <div className="flex-1">
                <h2 className="font-semibold text-[16px]">{report.summary.headline}</h2>
                <p className="text-[12px] text-[var(--pc-text-secondary)] mt-1">
                  Period {report.periodStart} → {report.periodEnd}  ·  Generated {new Date(report.generatedAt).toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={exportMd}><Download size={12} /> Markdown</Button>
                <Button variant="ghost" onClick={exportJson}><Download size={12} /> JSON</Button>
              </div>
            </div>
          </Glass>

          {report.summary.redFlags.length > 0 && (
            <Glass>
              <div className="p-4">
                <h3 className="font-medium text-[13px] mb-2">Red flags</h3>
                <ul className="space-y-1 text-[13px]">
                  {report.summary.redFlags.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-[var(--pc-state-danger)]">
                      <AlertTriangle size={12} className="mt-0.5" />{f}
                    </li>
                  ))}
                </ul>
              </div>
            </Glass>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Glass>
              <div className="p-4">
                <h3 className="font-medium text-[13px] mb-2">Schedule registers</h3>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr><td>Schedule H entries</td><td className="text-right font-mono">{report.schedH.totalCount}</td></tr>
                    <tr><td>Schedule X entries</td><td className="text-right font-mono">{report.schedX.totalCount}</td></tr>
                  </tbody>
                </table>
              </div>
            </Glass>
            <Glass>
              <div className="p-4">
                <h3 className="font-medium text-[13px] mb-2">E-invoice IRN reconciliation</h3>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr><td>OK</td><td className="text-right font-mono text-[var(--pc-state-success)]">{report.irnReconciliation.ok}</td></tr>
                    <tr><td>Missing</td><td className="text-right font-mono text-[var(--pc-state-danger)]">{report.irnReconciliation.missing}</td></tr>
                    <tr><td>Cancelled</td><td className="text-right font-mono">{report.irnReconciliation.cancelled}</td></tr>
                    <tr><td>Failed</td><td className="text-right font-mono text-[var(--pc-state-danger)]">{report.irnReconciliation.failed}</td></tr>
                  </tbody>
                </table>
              </div>
            </Glass>
            <Glass>
              <div className="p-4">
                <h3 className="font-medium text-[13px] mb-2">NPPA breaches</h3>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr><td>Total breaches</td><td className="text-right font-mono">{report.nppaBreaches.count}</td></tr>
                    <tr><td>Unapproved</td><td className="text-right font-mono text-[var(--pc-state-danger)]">{report.nppaBreaches.unapprovedCount}</td></tr>
                    <tr><td>Total overcharge</td><td className="text-right font-mono">{formatINR(paise(report.nppaBreaches.totalOverChargePaise as number))}</td></tr>
                  </tbody>
                </table>
              </div>
            </Glass>
            <Glass>
              <div className="p-4">
                <h3 className="font-medium text-[13px] mb-2">Expired-stock disposal</h3>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr><td>Disposed</td><td className="text-right font-mono text-[var(--pc-state-success)]">{report.expiredStock.disposedCount}</td></tr>
                    <tr><td>Pending disposal</td><td className="text-right font-mono text-[var(--pc-state-danger)]">{report.expiredStock.pendingDisposalCount}</td></tr>
                  </tbody>
                </table>
              </div>
            </Glass>
          </div>

          {report.summary.compliantSections.length > 0 && (
            <Glass>
              <div className="p-4">
                <h3 className="font-medium text-[13px] mb-2">Compliant</h3>
                <ul className="space-y-1 text-[13px]">
                  {report.summary.compliantSections.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-[var(--pc-state-success)]">
                      <CheckCircle2 size={12} className="mt-0.5" />{c}
                    </li>
                  ))}
                </ul>
              </div>
            </Glass>
          )}
        </>
      )}
    </div>
  );
}
