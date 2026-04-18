import { useCallback, useEffect, useState } from "react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
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

// CSV field escape. Exported for unit testing (see G05 / coverage audit
// 2026-04-18).
//
// Rules (RFC 4180 + Excel/LibreOffice formula-injection hardening):
//  - null/undefined  → empty string, no quoting.
//  - empty string    → empty, no quoting.
//  - contains `,` `"` `\n` or `\r` → wrap in double-quotes, double internal `"`.
//  - leading `=` `+` `-` `@` `\t` `\r` → prefix with `'` to neutralise
//    Excel/LibreOffice formula evaluation (soft-S security review finding).
//    The apostrophe is consumed by Excel on open; it does NOT appear as a
//    literal quote in the rendered cell. If the neutralised value also
//    needs quoting (e.g. a leading `=` followed by a comma), quoting wraps
//    the prefixed form: `"'=SUM(A1,B1)"` → cell reads `=SUM(A1,B1)` as text.
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (s.length === 0) return "";
  // Formula-injection neutralisation. Must happen BEFORE quoting so the
  // apostrophe lands inside the quoted span.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Build a CSV document from a row matrix. Exported for unit testing.
// Row terminator is CRLF (`\r\n`) per RFC 4180; Excel/LibreOffice/Tally
// all accept it, and it round-trips through Windows text tooling without
// line-ending mangling.
export function buildCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n");
}

function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]) {
  const csv = buildCsv(rows);
  // UTF-8 BOM so Excel on Windows auto-detects encoding (without the BOM
  // Excel defaults to the system ANSI codepage and mangles ₹ / Devanagari
  // / CJK cells).
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
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
  useEffect(() => { if (tab === "gstr1") void loadGstr(); }, [tab, loadGstr]);
  useEffect(() => { if (tab === "movers") void loadMovers(); }, [tab, loadMovers]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["daybook", "gstr1", "movers"] as Tab[]).map((t) => (
          <button
            key={t}
            data-testid={`rpt-tab-${t}`}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 14px", fontWeight: 500,
              background: tab === t ? "#1e3a8a" : "#eee",
              color: tab === t ? "#fff" : "#222",
              border: "none", borderRadius: 4, cursor: "pointer",
            }}
          >
            {t === "daybook" ? "Day-book" : t === "gstr1" ? "GSTR-1" : "Top Movers"}
          </button>
        ))}
      </div>

      {err && <div data-testid="rpt-err" style={{ color: "#b00020", marginBottom: 8 }}>{err}</div>}

      {tab === "daybook" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 10 }}>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
              Date
              <input
                type="date" data-testid="rpt-date"
                value={date} onChange={(e) => setDate(e.target.value)}
                style={{ padding: "6px 8px" }}
              />
            </label>
            <button
              data-testid="rpt-daybook-export"
              disabled={!daybook || daybook.rows.length === 0}
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
              style={{ padding: "6px 12px" }}
            >Export CSV</button>
          </div>
          {daybook && (
            <>
              <div data-testid="rpt-daybook-summary" style={{ display: "flex", gap: 24, marginBottom: 10, fontSize: 14 }}>
                <span>Bills: <b>{daybook.summary.billCount}</b></span>
                <span>Gross: <b>{formatINR(daybook.summary.grossPaise as Paise)}</b></span>
                <span>CGST: {formatINR(daybook.summary.cgstPaise as Paise)}</span>
                <span>SGST: {formatINR(daybook.summary.sgstPaise as Paise)}</span>
                <span>IGST: {formatINR(daybook.summary.igstPaise as Paise)}</span>
              </div>
              {daybook.rows.length === 0 ? (
                <div data-testid="rpt-daybook-empty" style={{ color: "#888" }}>No bills on {date}.</div>
              ) : (
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                      <th style={{ padding: 6 }}>Bill #</th><th style={{ padding: 6 }}>Time</th>
                      <th style={{ padding: 6 }}>Pay</th><th style={{ padding: 6 }}>Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daybook.rows.map((r) => (
                      <tr key={r.billId} data-testid={`rpt-daybook-row-${r.billId}`} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: 6 }}>{r.billNo}</td>
                        <td style={{ padding: 6 }}>{r.billedAt.slice(11, 19)}</td>
                        <td style={{ padding: 6 }}>{r.paymentMode}</td>
                        <td style={{ padding: 6 }}>{formatINR(r.grandTotalPaise as Paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}

      {tab === "gstr1" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 10 }}>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
              From
              <input type="date" data-testid="rpt-from" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
              To
              <input type="date" data-testid="rpt-to" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button
              data-testid="rpt-gstr-export"
              disabled={!gstr || gstr.length === 0}
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
              style={{ padding: "6px 12px" }}
            >Export CSV</button>
          </div>
          {gstr && (gstr.length === 0 ? (
            <div data-testid="rpt-gstr-empty" style={{ color: "#888" }}>No taxable sales in range.</div>
          ) : (
            <table data-testid="rpt-gstr-table" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                <th style={{ padding: 6 }}>Rate</th><th style={{ padding: 6 }}>Taxable</th>
                <th style={{ padding: 6 }}>CGST</th><th style={{ padding: 6 }}>SGST</th>
                <th style={{ padding: 6 }}>IGST</th><th style={{ padding: 6 }}>Lines</th>
              </tr></thead>
              <tbody>
                {gstr.map((b) => (
                  <tr key={b.gstRate} data-testid={`rpt-gstr-row-${b.gstRate}`} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: 6 }}>{b.gstRate}%</td>
                    <td style={{ padding: 6 }}>{formatINR(b.taxableValuePaise as Paise)}</td>
                    <td style={{ padding: 6 }}>{formatINR(b.cgstPaise as Paise)}</td>
                    <td style={{ padding: 6 }}>{formatINR(b.sgstPaise as Paise)}</td>
                    <td style={{ padding: 6 }}>{formatINR(b.igstPaise as Paise)}</td>
                    <td style={{ padding: 6 }}>{b.lineCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}

      {tab === "movers" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 10 }}>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
              From
              <input type="date" data-testid="rpt-mov-from" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
              To
              <input type="date" data-testid="rpt-mov-to" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          {movers && (movers.length === 0 ? (
            <div data-testid="rpt-mov-empty" style={{ color: "#888" }}>No sales in range.</div>
          ) : (
            <table data-testid="rpt-mov-table" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                <th style={{ padding: 6 }}>#</th><th style={{ padding: 6 }}>Product</th>
                <th style={{ padding: 6 }}>Qty</th><th style={{ padding: 6 }}>Revenue</th>
                <th style={{ padding: 6 }}>Bills</th>
              </tr></thead>
              <tbody>
                {movers.map((m, i) => (
                  <tr key={m.productId} data-testid={`rpt-mov-row-${m.productId}`} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: 6 }}>{i + 1}</td>
                    <td style={{ padding: 6 }}>{m.name}</td>
                    <td style={{ padding: 6 }}>{m.qtySold}</td>
                    <td style={{ padding: 6 }}>{formatINR(m.revenuePaise as Paise)}</td>
                    <td style={{ padding: 6 }}>{m.billCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </div>
  );
}
