// ComplianceScheduleHTab — Schedule H/H1/X register UI.
// FDA-inspector ready table; period filter; export to CSV/PDF.
//
// S26 Wave 2 Agent B — replaced the pre-pilot DEMO array (line ~15) with
// real IPC-hydrated state. Demo data was a CRITICAL hazard: an FDA inspector
// landing on this tab on Day-1 would see "Asha Iyer / Dr. Sharma" canned rows
// that look like real Schedule-H dispenses — a D&C §22/§27 violation.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Glass, Badge, Button, Input, Skeleton, useToast } from "@pharmacare/design-system";
import { Download, Search, Pill, AlertTriangle, RefreshCw, FileText } from "lucide-react";
import {
  listScheduleRegisterRpc, scheduleRegisterPdfPathRpc,
  type ScheduleRegisterRowDTO,
} from "../lib/ipc.js";

type ScheduleFilter = "all" | "H" | "H1" | "X";

interface Props {
  /** Shop scope. Defaults to "shop_local" (single-tenant pilot). */
  readonly shopId?: string;
  /** Optional override for "current month" — used by tests for determinism. */
  readonly today?: Date;
}

function monthBoundsIso(periodYyyymm: string): { start: string; end: string } {
  // Returns inclusive ISO date strings (YYYY-MM-DD) for first and last day of the month.
  // Explicit parse with guards — noUncheckedIndexedAccess marks parts[i] as string|undefined.
  const parts = periodYyyymm.split("-");
  const y = Number(parts[0] ?? "0");
  const m = Number(parts[1] ?? "0");
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function currentPeriodYyyymm(today: Date): string {
  return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
}

function downloadCsv(filename: string, header: readonly string[], rows: readonly (readonly string[])[]): void {
  const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const csv = [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ComplianceScheduleHTab({ shopId = "shop_local", today }: Props = {}): React.ReactElement {
  const { toast } = useToast();
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<string>(() => currentPeriodYyyymm(today ?? new Date()));
  const [rows, setRows] = useState<readonly ScheduleRegisterRowDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const bounds = useMemo(() => monthBoundsIso(period), [period]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await listScheduleRegisterRpc({
          periodStartIso: bounds.start,
          periodEndIso: bounds.end,
          schedule: filter,
          shopId,
        });
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load Schedule register: ${String(e)}`);
          setRows([]);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [bounds.start, bounds.end, filter, shopId, refreshKey]);

  const filtered = useMemo(() => {
    const base = rows ?? [];
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter((r) =>
      r.customerName.toLowerCase().includes(q)
      || r.doctorName.toLowerCase().includes(q)
      || r.drug.toLowerCase().includes(q)
      || r.batchNo.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const exportCsv = useCallback(() => downloadCsv(
    `register_${filter}_${bounds.start}_${bounds.end}.csv`,
    ["Bill No","Date","Schedule","Customer","Doctor","Reg No","Drug","Batch","Qty","Rx Img","Witness"],
    filtered.map((r) => [
      r.billNo, r.billedAt, r.schedule, r.customerName, r.doctorName, r.doctorRegNo,
      r.drug, r.batchNo, String(r.qty), r.rxImage ? "Y" : "N", r.witnessName ?? "",
    ]),
  ), [filtered, filter, bounds.start, bounds.end]);

  const exportPdf = useCallback(async () => {
    try {
      const path = await scheduleRegisterPdfPathRpc({
        periodStartIso: bounds.start,
        periodEndIso: bounds.end,
        schedule: filter,
        shopId,
      });
      toast({ variant: "success", title: "Schedule register PDF written", description: path });
    } catch (e) {
      toast({ variant: "error", title: "PDF export not available", description: String(e) });
    }
  }, [bounds.start, bounds.end, filter, shopId, toast]);

  return (
    <div className="flex flex-col gap-3" data-testid="schedule-h-tab">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pill size={16} aria-hidden /><h2 className="font-medium">Schedule H · H1 · X register</h2>
          <Badge variant="neutral" data-testid="sched-row-count">{filtered.length} entries</Badge>
        </div>
        <div className="flex gap-1 items-center">
          <label className="text-[12px] text-[var(--pc-text-secondary)] mr-1">Period</label>
          <Input
            type="month"
            aria-label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value || period)}
            data-testid="sched-period"
          />
          {(["all","H","H1","X"] as const).map((s) => (
            <Button key={s} variant={filter === s ? "default" : "ghost"} onClick={() => setFilter(s)} data-testid={`sched-filter-${s}`}>{s.toUpperCase()}</Button>
          ))}
          <Button variant="ghost" onClick={exportCsv}><Download size={12} /> CSV</Button>
          <Button variant="ghost" onClick={exportPdf} data-testid="sched-export-pdf"><FileText size={12} /> PDF</Button>
        </div>
      </div>

      <Glass>
        <div className="p-3 flex items-center gap-2">
          <Search size={14} className="text-[var(--pc-text-secondary)]" aria-hidden />
          <Input placeholder="Search customer · doctor · drug · batch…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Glass>

      {error && (
        <Glass>
          <div className="p-3 flex items-center justify-between gap-2 text-[var(--pc-state-danger)]" data-testid="sched-error">
            <span className="flex items-center gap-2 text-[12px]">
              <AlertTriangle size={14} /> {error}
            </span>
            <Button variant="ghost" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshCw size={12} /> Retry
            </Button>
          </div>
        </Glass>
      )}

      <Glass>
        <div className="p-4 overflow-x-auto">
          {loading ? (
            <div className="flex flex-col gap-2" data-testid="sched-loading">
              <Skeleton width="100%" height={32} />
              <Skeleton width="100%" height={28} />
              <Skeleton width="100%" height={28} />
              <Skeleton width="100%" height={28} />
            </div>
          ) : (
            <>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                    <th className="py-2 font-medium">Bill</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Sched</th>
                    <th className="py-2 font-medium">Customer</th>
                    <th className="py-2 font-medium">Doctor</th>
                    <th className="py-2 font-medium">Reg No</th>
                    <th className="py-2 font-medium">Drug</th>
                    <th className="py-2 font-medium">Batch</th>
                    <th className="py-2 font-medium text-right">Qty</th>
                    <th className="py-2 font-medium">Rx</th>
                    <th className="py-2 font-medium">Witness</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.billId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                      <td className="py-1.5 font-mono">{r.billNo}</td>
                      <td className="py-1.5">{r.billedAt}</td>
                      <td className="py-1.5">
                        <Badge variant={r.schedule === "X" ? "danger" : r.schedule === "H1" ? "warning" : "info"}>{r.schedule}</Badge>
                      </td>
                      <td className="py-1.5">{r.customerName}</td>
                      <td className="py-1.5">{r.doctorName}</td>
                      <td className="py-1.5 text-[var(--pc-text-secondary)]">{r.doctorRegNo}</td>
                      <td className="py-1.5">{r.drug}</td>
                      <td className="py-1.5 font-mono text-[var(--pc-text-secondary)]">{r.batchNo}</td>
                      <td className="py-1.5 font-mono tabular-nums text-right">{r.qty}</td>
                      <td className="py-1.5">{r.rxImage ? <Badge variant="success">✓</Badge> : <Badge variant="warning">—</Badge>}</td>
                      <td className="py-1.5">{r.witnessName ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && !error && (
                <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center" data-testid="sched-empty">
                  {search.trim()
                    ? "No entries match."
                    : `No Schedule-${filter === "all" ? "H/H1/X" : filter} dispenses in this period`}
                </div>
              )}
            </>
          )}
        </div>
      </Glass>
    </div>
  );
}
