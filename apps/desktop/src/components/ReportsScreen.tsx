import { useCallback, useEffect, useState } from "react";
import { Download, Calendar, Receipt, Crown } from "lucide-react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
import {
  Glass,
  Card,
  CardKpi,
  Badge,
  Button,
  Input,
  Skeleton,
  formatINRCompact,
  formatNumber,
} from "@pharmacare/design-system";
import {
  dayBookRpc, gstr1SummaryRpc, topMoversRpc,
  type DayBook, type GstrBucket, type TopMoverRow,
} from "../lib/ipc.js";

const SHOP_ID = "shop_vaidyanath_kalyan";
type Tab = "daybook" | "gstr1" | "movers";

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// CSV helpers — exported for unit testing.
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (s.length === 0) return "";
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function buildCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n");
}
function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]) {
  const csv = buildCsv(rows);
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportsScreen() {
  const [tab, setTab] = useState<Tab>("daybook");
  const [date, setDate] = useState(todayISO());
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [daybook, setDaybook] = useState<DayBook | null>(null);
  const [gstr, setGstr] = useState<readonly GstrBucket[] | null>(null);
  const [movers, setMovers] = useState<readonly TopMoverRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadDaybook = useCallback(async () => {
    try { setErr(null); setDaybook(await dayBookRpc(SHOP_ID, date)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [date]);
  const loadGstr = useCallback(async () => {
    try { setErr(null); setGstr(await gstr1SummaryRpc(SHOP_ID, from, to)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [from, to]);
  const loadMovers = useCallback(async () => {
    try { setErr(null); setMovers(await topMoversRpc(SHOP_ID, from, to, 10)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [from, to]);

  useEffect(() => { if (tab === "daybook") void loadDaybook(); }, [tab, loadDaybook]);
  useEffect(() => { if (tab === "gstr1")   void loadGstr();   }, [tab, loadGstr]);
  useEffect(() => { if (tab === "movers")  void loadMovers(); }, [tab, loadMovers]);

  return (
    <div className="mx-auto max-w-[1280px] p-4 lg:p-6 text-[var(--pc-text-primary)]">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight">Reports</h1>
        <div role="tablist" aria-label="Reports tabs" className="ml-auto flex items-center gap-0.5 rounded-[var(--pc-radius-md)] bg-[var(--pc-bg-surface-2)] p-0.5">
          {(["daybook", "gstr1", "movers"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              data-testid={`rpt-tab-${t}`}
              onClick={() => setTab(t)}
              className={
                "rounded-[var(--pc-radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors " +
                (tab === t
                  ? "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)] shadow-[var(--pc-elevation-1)]"
                  : "text-[var(--pc-text-secondary)] hover:text-[var(--pc-text-primary)]")
              }
            >
              {t === "daybook" ? "Day-book" : t === "gstr1" ? "GSTR-1" : "Top movers"}
            </button>
          ))}
        </div>
      </header>

      {err && (
        <div data-testid="rpt-err" className="mb-3 rounded-[var(--pc-radius-md)] border border-[var(--pc-state-danger)] bg-[var(--pc-state-danger-bg)] px-3 py-2 text-[12px] text-[var(--pc-state-danger)]">
          {err}
        </div>
      )}

      {tab === "daybook" && (
        <div className="flex flex-col gap-3">
          <Glass depth={1} className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-[var(--pc-text-secondary)]">
                <span className="inline-flex items-center gap-1"><Calendar size={12} /> Date</span>
                <Input type="date" data-testid="rpt-date" value={date} onChange={(e) => setDate(e.target.value)} className="!w-[180px]" />
              </label>
              <Button
                variant="saffron"
                size="sm"
                data-testid="rpt-daybook-export"
                disabled={!daybook || daybook.rows.length === 0}
                leadingIcon={<Download size={14} />}
                onClick={() => {
                  if (!daybook) return;
                  const rows: string[][] = [
                    ["Bill No", "Billed At", "Payment", "Gross (₹)", "CGST", "SGST", "IGST", "Voided"],
                    ...daybook.rows.map((r) => [
                      r.billNo, r.billedAt, r.paymentMode,
                      (r.grandTotalPaise / 100).toFixed(2),
                      (r.cgstPaise / 100).toFixed(2),
                      (r.sgstPaise / 100).toFixed(2),
                      (r.igstPaise / 100).toFixed(2),
                      r.isVoided ? "Y" : "N",
                    ]),
                  ];
                  downloadCsv(`daybook-${date}.csv`, rows);
                }}
              >
                Export CSV
              </Button>
            </div>
          </Glass>

          {daybook ? (
            <>
              <div data-testid="rpt-daybook-summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Card variant="recessed" className="p-3 px-4"><CardKpi label="Bills:" value={formatNumber(daybook.summary.billCount)} /></Card>
                <Card variant="recessed" className="p-3 px-4"><CardKpi label="Gross:" value={formatINRCompact(daybook.summary.grossPaise)} /></Card>
                <Card variant="recessed" className="p-3 px-4"><CardKpi label="CGST:" value={formatINR(daybook.summary.cgstPaise as Paise)} /></Card>
                <Card variant="recessed" className="p-3 px-4"><CardKpi label="SGST:" value={formatINR(daybook.summary.sgstPaise as Paise)} /></Card>
                <Card variant="recessed" className="p-3 px-4"><CardKpi label="IGST:" value={formatINR(daybook.summary.igstPaise as Paise)} /></Card>
              </div>
              {daybook.rows.length === 0 ? (
                <Glass depth={1} className="p-8 text-center text-[12px] text-[var(--pc-text-tertiary)]">
                  <div data-testid="rpt-daybook-empty">No bills on {date}.</div>
                </Glass>
              ) : (
                <Glass depth={1} className="p-0 overflow-hidden">
                  <div className="overflow-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <thead className="sticky top-0 bg-[color-mix(in_oklab,var(--pc-bg-surface-2)_92%,transparent)] backdrop-blur z-10">
                        <tr className="text-left text-[10px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                          <th className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-medium">Bill #</th>
                          <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">Time</th>
                          <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">Pay</th>
                          <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daybook.rows.map((r) => (
                          <tr key={r.billId} data-testid={`rpt-daybook-row-${r.billId}`} className="hover:bg-[var(--pc-bg-surface-2)] transition-colors">
                            <td className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-mono text-[12px]">{r.billNo}</td>
                            <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 pc-tabular text-[var(--pc-text-secondary)]">{r.billedAt.slice(11, 19)}</td>
                            <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2"><Badge variant="info">{r.paymentMode}</Badge></td>
                            <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular font-medium">{formatINR(r.grandTotalPaise as Paise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Glass>
              )}
            </>
          ) : (
            <Skeleton width="100%" height={200} />
          )}
        </div>
      )}

      {tab === "gstr1" && (
        <div className="flex flex-col gap-3">
          <Glass depth={1} className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-[var(--pc-text-secondary)]">
                <span>From</span>
                <Input type="date" data-testid="rpt-from" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-[180px]" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--pc-text-secondary)]">
                <span>To</span>
                <Input type="date" data-testid="rpt-to" value={to} onChange={(e) => setTo(e.target.value)} className="!w-[180px]" />
              </label>
              <Button
                variant="saffron"
                size="sm"
                data-testid="rpt-gstr-export"
                disabled={!gstr || gstr.length === 0}
                leadingIcon={<Download size={14} />}
                onClick={() => {
                  if (!gstr) return;
                  const rows: string[][] = [
                    ["GST Rate", "Taxable (₹)", "CGST", "SGST", "IGST", "Lines"],
                    ...gstr.map((b) => [
                      String(b.gstRate),
                      (b.taxableValuePaise / 100).toFixed(2),
                      (b.cgstPaise / 100).toFixed(2),
                      (b.sgstPaise / 100).toFixed(2),
                      (b.igstPaise / 100).toFixed(2),
                      String(b.lineCount),
                    ]),
                  ];
                  downloadCsv(`gstr1-${from}-to-${to}.csv`, rows);
                }}
              >
                Export CSV
              </Button>
            </div>
          </Glass>

          {gstr ? (gstr.length === 0 ? (
            <Glass depth={1} className="p-8 text-center text-[12px] text-[var(--pc-text-tertiary)]">
              <div data-testid="rpt-gstr-empty">No taxable sales in range.</div>
            </Glass>
          ) : (
            <Glass depth={1} className="p-0 overflow-hidden">
              <div className="overflow-auto">
                <table data-testid="rpt-gstr-table" className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 bg-[color-mix(in_oklab,var(--pc-bg-surface-2)_92%,transparent)] backdrop-blur z-10">
                    <tr className="text-left text-[10px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                      <th className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-medium">Rate</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Taxable</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">CGST</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">SGST</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">IGST</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gstr.map((b) => (
                      <tr key={b.gstRate} data-testid={`rpt-gstr-row-${b.gstRate}`} className="hover:bg-[var(--pc-bg-surface-2)] transition-colors">
                        <td className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-medium pc-tabular">{b.gstRate}%</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular">{formatINR(b.taxableValuePaise as Paise)}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular text-[var(--pc-text-secondary)]">{formatINR(b.cgstPaise as Paise)}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular text-[var(--pc-text-secondary)]">{formatINR(b.sgstPaise as Paise)}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular text-[var(--pc-text-secondary)]">{formatINR(b.igstPaise as Paise)}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular">{b.lineCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Glass>
          )) : <Skeleton width="100%" height={160} />}
        </div>
      )}

      {tab === "movers" && (
        <div className="flex flex-col gap-3">
          <Glass depth={1} className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-[var(--pc-text-secondary)]">
                <span>From</span>
                <Input type="date" data-testid="rpt-mov-from" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-[180px]" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--pc-text-secondary)]">
                <span>To</span>
                <Input type="date" data-testid="rpt-mov-to" value={to} onChange={(e) => setTo(e.target.value)} className="!w-[180px]" />
              </label>
            </div>
          </Glass>

          {movers ? (movers.length === 0 ? (
            <Glass depth={1} className="p-8 text-center text-[12px] text-[var(--pc-text-tertiary)]">
              <div data-testid="rpt-mov-empty">No sales in range.</div>
            </Glass>
          ) : (
            <Glass depth={1} className="p-0 overflow-hidden">
              <div className="overflow-auto">
                <table data-testid="rpt-mov-table" className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 bg-[color-mix(in_oklab,var(--pc-bg-surface-2)_92%,transparent)] backdrop-blur z-10">
                    <tr className="text-left text-[10px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                      <th className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-medium w-12">#</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-medium">Product</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Qty</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Revenue</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Bills</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movers.map((m, i) => {
                      const max = movers[0]?.revenuePaise ?? 1;
                      const pct = max > 0 ? (m.revenuePaise / max) * 100 : 0;
                      return (
                        <tr key={m.productId} data-testid={`rpt-mov-row-${m.productId}`} className="hover:bg-[var(--pc-bg-surface-2)] transition-colors">
                          <td className="border-b border-[var(--pc-border-subtle)] px-3 py-2 align-middle">
                            <span
                              className={
                                "inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-medium " +
                                (i === 0 ? "bg-[var(--pc-accent-saffron)] text-[var(--pc-bg-surface)]" :
                                 i < 3   ? "bg-[var(--pc-brand-primary-soft)] text-[var(--pc-brand-primary-hover)]" :
                                           "bg-[var(--pc-bg-surface-2)] text-[var(--pc-text-secondary)]")
                              }
                            >
                              {i === 0 ? <Crown size={12} aria-hidden /> : i + 1}
                            </span>
                          </td>
                          <td className="border-b border-[var(--pc-border-subtle)] px-3 py-2 font-medium">{m.name}</td>
                          <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular">{m.qtySold}</td>
                          <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular align-middle">
                            <div className="inline-flex items-center gap-2">
                              <span className="hidden sm:inline-block h-1.5 w-[80px] bg-[var(--pc-bg-surface-3)] rounded-full overflow-hidden align-middle">
                                <span className="block h-full bg-[var(--pc-brand-primary)]" style={{ width: `${pct.toFixed(1)}%` }} />
                              </span>
                              <span>{formatINR(m.revenuePaise as Paise)}</span>
                            </div>
                          </td>
                          <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular">{m.billCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Glass>
          )) : <Skeleton width="100%" height={160} />}
        </div>
      )}
    </div>
  );
}
