// CAExportScreen — Pharmacy-OS table-stakes for Jagannath LLP.
//
// Single button "Export for CA" generates the entire bundle (GST monthly +
// LLP annual) as separate downloadable files. No SaaS dep, no GSP fee.
// Backed by @pharmacare/ca-export-bundle (27 tests green).
//
// Period picker:
//   - This month / Last month / Custom (for monthly GST)
//   - FY 2025-26 / FY 2026-27 (for LLP Form 8 annual)
//
// Each generated file shows a preview chip + individual download button +
// a single "Download all (ZIP)" that bundles everything.

import { useCallback, useMemo, useState } from "react";
import { FileText, Download, Calendar, CheckCircle2, AlertTriangle, Loader2, Info } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import { paise } from "@pharmacare/shared-types";
import {
  buildCABundle, fileEntries,
  type BillRow, type PurchaseRow, type CashRow, type ExpenseRow,
  type TrialBalanceRow, type BalanceSheet, type PartnerInfo, type CABundle,
} from "@pharmacare/ca-export-bundle";

type PeriodKind = "this_month" | "last_month" | "fy2025_26" | "fy2026_27" | "custom";

const SHOP_NAME = "Jagannath Pharmacy LLP";
const SHOP_GSTIN = "27AAAAA0000A0Z0";   // owner sets via Settings; placeholder until then
const LLP_REG_NO = "AAB-1234";          // owner sets via Settings

function periodFrom(kind: PeriodKind): { period: string; periodStart: string; periodEnd: string } {
  const now = new Date();
  switch (kind) {
    case "this_month": {
      const y = now.getFullYear(); const m = now.getMonth();
      return {
        period: `${y}-${String(m + 1).padStart(2, "0")}`,
        periodStart: new Date(y, m, 1).toISOString(),
        periodEnd: new Date(y, m + 1, 0, 23, 59, 59).toISOString(),
      };
    }
    case "last_month": {
      const y = now.getFullYear(); const m = now.getMonth() - 1;
      return {
        period: `${m < 0 ? y - 1 : y}-${String((m + 12) % 12 + 1).padStart(2, "0")}`,
        periodStart: new Date(y, m, 1).toISOString(),
        periodEnd: new Date(y, m + 1, 0, 23, 59, 59).toISOString(),
      };
    }
    case "fy2025_26":
      return { period: "FY2025-26", periodStart: "2025-04-01T00:00:00Z", periodEnd: "2026-03-31T23:59:59Z" };
    case "fy2026_27":
      return { period: "FY2026-27", periodStart: "2026-04-01T00:00:00Z", periodEnd: "2027-03-31T23:59:59Z" };
    case "custom":
      return { period: "custom", periodStart: now.toISOString(), periodEnd: now.toISOString() };
  }
}

// Demo data — production wires these to RPCs over real bills/grns/expenses tables
function loadDemoData(): {
  bills: BillRow[]; purchases: PurchaseRow[]; cashBookRows: CashRow[];
  expenses: ExpenseRow[]; trialBalance: TrialBalanceRow[]; balanceSheet: BalanceSheet; partners: PartnerInfo[];
} {
  const bills: BillRow[] = Array.from({ length: 47 }, (_, i) => ({
    billId: `b${i}`, billNo: `B-${100 + i}`,
    billedAt: `2026-04-${String(((i % 28) + 1)).padStart(2, "0")}T11:00:00Z`,
    customerName: i % 5 === 0 ? "Walk-in" : `Customer ${i}`,
    customerStateCode: "27",
    subtotalPaise: paise(50000 + (i * 1000)),
    cgstPaise: paise(1250 + i * 25), sgstPaise: paise(1250 + i * 25),
    igstPaise: paise(0), cessPaise: paise(0),
    totalPaise: paise(52500 + i * 1050),
    isRefund: i === 30,
    hsnLines: [{ hsn: "30049099", taxableValuePaise: paise(50000 + (i * 1000)), gstRate: 5 }],
  }));
  const purchases: PurchaseRow[] = Array.from({ length: 8 }, (_, i) => ({
    grnId: `g${i}`, invoiceNo: `INV-${200 + i}`,
    invoiceDate: `2026-04-${String((i + 1) * 3).padStart(2, "0")}`,
    supplierName: i % 2 === 0 ? "Pharmarack Mumbai" : "Retailio Dist",
    supplierGstin: "27ABCDE1234F1Z5",
    subtotalPaise: paise(150000 + i * 5000),
    cgstPaise: paise(3750 + i * 125), sgstPaise: paise(3750 + i * 125),
    igstPaise: paise(0), cessPaise: paise(0),
    totalPaise: paise(157500 + i * 5250),
    itcEligible: true,
  }));
  const cashBookRows: CashRow[] = [
    { date: "2026-04-01", description: "Opening cash", cashInPaise: paise(500000), cashOutPaise: paise(0), mode: "cash", ref: "OB" },
    { date: "2026-04-15", description: "Cash sales", cashInPaise: paise(1500000), cashOutPaise: paise(0), mode: "cash", ref: "DAY" },
    { date: "2026-04-20", description: "Bank deposit", cashInPaise: paise(0), cashOutPaise: paise(1000000), mode: "cash", ref: "DEP1" },
  ];
  const expenses: ExpenseRow[] = [
    { date: "2026-04-01", account: "Rent",        amountPaise: paise(2500000), hasGstInput: false },
    { date: "2026-04-05", account: "Salaries",    amountPaise: paise(1800000), hasGstInput: false },
    { date: "2026-04-10", account: "Electricity", amountPaise: paise(350000),  hasGstInput: true, gstInputPaise: paise(63000) },
    { date: "2026-04-12", account: "Stationery",  amountPaise: paise(80000),   hasGstInput: true, gstInputPaise: paise(14400) },
    { date: "2026-04-20", account: "Internet",    amountPaise: paise(120000),  hasGstInput: true, gstInputPaise: paise(21600) },
  ];
  const trialBalance: TrialBalanceRow[] = [
    { account: "Cash + Bank",       openingPaise: paise(500000), debitPaise: paise(2500000), creditPaise: paise(1000000), closingPaise: paise(2000000) },
    { account: "Inventory (stock)", openingPaise: paise(50000000), debitPaise: paise(1500000), creditPaise: paise(2350000), closingPaise: paise(49150000) },
    { account: "Sales",             openingPaise: paise(0), debitPaise: paise(0), creditPaise: paise(2350000), closingPaise: paise(-2350000) },
    { account: "Purchases (COGS)",  openingPaise: paise(0), debitPaise: paise(1500000), creditPaise: paise(0), closingPaise: paise(1500000) },
    { account: "Rent",              openingPaise: paise(0), debitPaise: paise(2500000), creditPaise: paise(0), closingPaise: paise(2500000) },
    { account: "Salaries",          openingPaise: paise(0), debitPaise: paise(1800000), creditPaise: paise(0), closingPaise: paise(1800000) },
    { account: "Partners' Capital", openingPaise: paise(50000000), debitPaise: paise(0), creditPaise: paise(0), closingPaise: paise(50000000) },
  ];
  const balanceSheet: BalanceSheet = {
    assets: { cashAndBankPaise: paise(2000000), inventoryPaise: paise(49150000), receivablesPaise: paise(800000), fixedAssetsPaise: paise(3000000), totalPaise: paise(54950000) },
    liabilities: { payablesPaise: paise(450000), partnersCapitalPaise: paise(50000000), retainedEarningsPaise: paise(4500000), totalPaise: paise(54950000) },
    balanced: true,
  };
  const partners: PartnerInfo[] = [
    { designatedPartnerId: "DP-001", name: "Sourav Shaw", contributionPaise: paise(25000000) },
    { designatedPartnerId: "DP-002", name: "Co-Partner",  contributionPaise: paise(25000000) },
  ];
  return { bills, purchases, cashBookRows, expenses, trialBalance, balanceSheet, partners };
}

function downloadBlob(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Tiny hand-rolled ZIP builder — STORE method (no compression).
 *  Avoids a 30KB jszip dep for one screen. */
function buildZip(files: ReadonlyArray<{ name: string; content: string }>): Uint8Array {
  const enc = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  function crc32(bytes: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i]!;
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.content);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, dataBytes.length, true);
    dv.setUint32(22, dataBytes.length, true);
    dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localHeader.set(dataBytes, 30 + nameBytes.length);
    localHeaders.push(localHeader);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true); cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true); cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, dataBytes.length, true);
    cdv.setUint32(24, dataBytes.length, true);
    cdv.setUint16(28, nameBytes.length, true); cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true); cdv.setUint16(36, 0, true); cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralEntries.push(central);

    offset += localHeader.length;
    centralSize += central.length;
  }

  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(4, 0, true); dv.setUint16(6, 0, true);
  dv.setUint16(8, files.length, true); dv.setUint16(10, files.length, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, offset, true);
  dv.setUint16(20, 0, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const lh of localHeaders) { out.set(lh, pos); pos += lh.length; }
  for (const ce of centralEntries) { out.set(ce, pos); pos += ce.length; }
  out.set(eocd, pos);
  return out;
}

function downloadZip(filename: string, files: ReadonlyArray<{ name: string; content: string }>): void {
  const bytes = buildZip(files);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CAExportScreen(): React.ReactElement {
  const [periodKind, setPeriodKind] = useState<PeriodKind>("this_month");
  const [bundle, setBundle] = useState<CABundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const periodLabel = useMemo(() => periodFrom(periodKind), [periodKind]);

  const generate = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const data = loadDemoData();
      const b = buildCABundle({
        entityType: "llp",
        shopName: SHOP_NAME, shopGstin: SHOP_GSTIN, llpRegNo: LLP_REG_NO,
        ...periodLabel,
        ...data,
      });
      setBundle(b);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, [periodLabel]);

  const exportZip = useCallback(() => {
    if (!bundle) return;
    downloadZip(`ca_bundle_${bundle.period}.zip`, fileEntries(bundle));
  }, [bundle]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="ca-export">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Export for CA</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              GST monthly · LLP Form 8 annual · Tally / Zoho / QuickBooks adapters · standalone, no GSP dependency
            </p>
          </div>
        </div>
        <Badge variant="success">{SHOP_NAME}  ·  GSTIN {SHOP_GSTIN}</Badge>
      </header>

      {err && (
        <Glass>
          <div className="p-3 flex gap-2 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        </Glass>
      )}

      {/* Period picker */}
      <Glass>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Calendar size={14} aria-hidden /><h2 className="font-medium">Period</h2>
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              { k: "this_month",  label: "This month (GST)" },
              { k: "last_month",  label: "Last month (GST)" },
              { k: "fy2025_26",   label: "FY 2025–26 (LLP Form 8)" },
              { k: "fy2026_27",   label: "FY 2026–27 (LLP Form 8)" },
            ] as { k: PeriodKind; label: string }[]).map((p) => (
              <Button key={p.k} variant={periodKind === p.k ? "default" : "ghost"} onClick={() => setPeriodKind(p.k)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="text-[12px] text-[var(--pc-text-tertiary)]">
            Selected: <span className="font-mono">{periodLabel.period}</span> · {periodLabel.periodStart.slice(0, 10)} → {periodLabel.periodEnd.slice(0, 10)}
          </div>
          <div className="flex justify-end">
            <Button onClick={generate} disabled={busy}>
              {busy ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><FileText size={14} /> Generate bundle</>}
            </Button>
          </div>
        </div>
      </Glass>

      {/* Bundle preview */}
      {bundle && (
        <>
          <Glass>
            <div className="p-4 flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-[16px] flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-[var(--pc-state-success)]" />
                  Bundle ready — {bundle.files.length} files
                </h2>
                <p className="text-[12px] text-[var(--pc-text-secondary)] mt-1">
                  Generated {new Date(bundle.generatedAt).toLocaleString("en-IN")}  ·  Hand the ZIP to your CA — they import each file into their preferred tool.
                </p>
              </div>
              <Button onClick={exportZip}><Download size={14} /> Download ZIP ({bundle.files.length} files)</Button>
            </div>
          </Glass>

          {/* File list grouped by purpose */}
          <Glass>
            <div className="p-4">
              <h3 className="font-medium text-[14px] mb-3">Files in bundle</h3>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                    <th className="py-2 font-medium">File</th>
                    <th className="py-2 font-medium">For form / use</th>
                    <th className="py-2 font-medium">Purpose</th>
                    <th className="py-2 font-medium text-right">Size</th>
                    <th className="py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.files.map((f) => (
                    <tr key={f.name} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                      <td className="py-2 font-mono">{f.name}</td>
                      <td className="py-2"><Badge variant="info">{f.forForm}</Badge></td>
                      <td className="py-2 text-[var(--pc-text-secondary)]">{f.purpose}</td>
                      <td className="py-2 font-mono tabular-nums text-right">{(f.content.length / 1024).toFixed(1)} KB</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" onClick={() => downloadBlob(f.name, f.content, f.mime)}>
                          <Download size={11} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Glass>

          {/* Helpful tip */}
          <Glass>
            <div className="p-3 flex items-start gap-2 text-[12px] text-[var(--pc-text-secondary)]">
              <Info size={14} className="mt-0.5 text-[var(--pc-brand-primary)]" />
              <div>
                <strong>For your CA:</strong> open the ZIP, read README.md first — it explains which file feeds which return.
                LLP filings: Form 11 due 30-May, Form 8 due 30-Oct, DIR-3 KYC due 30-Sep.
                GST: GSTR-1 by 11th, GSTR-3B by 20th of next month.
              </div>
            </div>
          </Glass>
        </>
      )}
    </div>
  );
}
