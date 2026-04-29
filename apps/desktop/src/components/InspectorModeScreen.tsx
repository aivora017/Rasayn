// InspectorModeScreen — single-tap FDA inspector report.
import { useCallback, useState } from "react";
import { Eye, AlertTriangle, CheckCircle2, Download, FileText } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import { paise, formatINR } from "@pharmacare/shared-types";
import {
  buildInspectorReport, renderInspectorReportMarkdown,
  type InspectorReport,
} from "@pharmacare/inspector-mode";

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TODAY = "2026-04-28";

export default function InspectorModeScreen(): React.ReactElement {
  const [report, setReport] = useState<InspectorReport | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(() => {
    setBusy(true);
    try {
      // Demo aggregation — production wires this to RPC over real DB rows.
      const r = buildInspectorReport({
        shopId: "shop_local",
        periodStart: "2026-04-01",
        periodEnd: TODAY,
        generatedAt: new Date().toISOString(),
        generatedByUserId: "u_owner",
        schedHRows: Array.from({ length: 47 }, (_, i) => ({
          billId: `b${i}`, billNo: `B-${100+i}`, billedAt: "2026-04-15",
          customerName: "Demo Customer", doctorName: "Dr. Sharma", doctorRegNo: "MH-12345",
          drugName: "Amoxicillin 500mg", batchNo: "BN1", qty: 10,
        })),
        schedXRows: [],
        ndpsRows: [],
        irnRows: [
          ...Array.from({ length: 45 }, (_, i) => ({ billId: `b${i}`, billNo: `B-${100+i}`, billedAt: "2026-04-15", grandTotalPaise: paise(80000), status: "ok" as const })),
          { billId: "b46", billNo: "B-146", billedAt: "2026-04-22", grandTotalPaise: paise(50000), status: "missing" as const },
          { billId: "b47", billNo: "B-147", billedAt: "2026-04-23", grandTotalPaise: paise(60000), status: "missing" as const },
        ],
        nppaRows: [
          { billId: "b48", billNo: "B-148", productId: "p1", productName: "Crocin",
            mrpPaise: paise(5500), nppaCapPaise: paise(5000),
            overChargePaise: paise(500), approvedByUserId: "u_owner", approvalReason: "stockout emergency" },
        ],
        expiredRows: [
          { batchId: "bn_exp1", productName: "Insulin Glargine", batchNo: "INS-23-04", expiryDate: "2026-03-15", qty: 3,
            disposedAt: "2026-04-01", disposalMethod: "incinerated", approvedByUserId: "u_owner" },
        ],
        counselingSummary: { bills_with_counseling: 47, bills_requiring_counseling: 47 },
      });
      setReport(r);
    } finally { setBusy(false); }
  }, []);

  const exportMd = useCallback(() => {
    if (!report) return;
    downloadBlob(`inspector_${report.periodStart}_${report.periodEnd}.md`,
      renderInspectorReportMarkdown(report), "text/markdown");
  }, [report]);

  const exportJson = useCallback(() => {
    if (!report) return;
    downloadBlob(`inspector_${report.periodStart}_${report.periodEnd}.json`,
      JSON.stringify(report, null, 2), "application/json");
  }, [report]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="inspector-mode">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Inspector Mode</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Single-tap compliance bundle for FDA / Drug Inspector visits.
            </p>
          </div>
        </div>
        <Button onClick={generate} disabled={busy}>
          <FileText size={14} /> {busy ? "Generating…" : report ? "Re-generate" : "Generate report"}
        </Button>
      </header>

      {!report && (
        <Glass>
          <div className="p-6 flex flex-col items-center gap-2 text-[var(--pc-text-secondary)]">
            <Eye size={32} className="text-[var(--pc-brand-primary)]" />
            <p className="text-[14px] font-medium">No report generated yet.</p>
            <p className="text-[12px]">Click <strong>Generate report</strong> to compose Schedule registers, IRN reconciliation, NPPA breaches, expired-stock disposal, and counseling summary.</p>
          </div>
        </Glass>
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
