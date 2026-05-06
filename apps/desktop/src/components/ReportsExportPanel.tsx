// ReportsExportPanel — drop-in panel for ReportsScreen.
// Exposes: Tally Prime XML · Zoho Books CSV · QuickBooks IIF
//          GSTR-3B summary · GSTR-2B reconcile · GSTR-9 annual
//
// S26 Wave 2 Agent B — GSTR-3B button now calls the real
// `generate_gstr3b_payload` IPC and downloads the returned JSON. The
// pre-pilot SAMPLE_BILLS / SAMPLE_PURCHASES arrays (lines 22-31) only
// remain to feed Tally / Zoho / QuickBooks / GSTR-2B / GSTR-9 buttons,
// which are tracked as separate follow-ups (those exporters need their
// own RPCs from Agent A).

import { useCallback, useState } from "react";
import { Download, FileSpreadsheet, Receipt, Shield, AlertCircle, CheckCircle2 } from "lucide-react";
import { Glass, Button, Badge } from "@pharmacare/design-system";
import { paise } from "@pharmacare/shared-types";
import {
  buildTallyXml, buildZohoBooksCsv, buildQuickBooksIIF,
  billToSalesVoucher, type TallyVoucher,
} from "@pharmacare/tally-export";
import {
  buildGstr3b, reconcile2b, buildGstr9,
  type BillRow, type PurchaseRow, type Gstr2bPortalRow, type Gstr3b,
} from "@pharmacare/gst-extras";
import { generateGstr3bPayloadRpc } from "../lib/ipc.js";

// Sample data — still used by Tally / Zoho / QB / GSTR-2B / GSTR-9 paths.
// Connect to live `/list_bills`, `/list_purchases` RPCs once the Tally
// accountant signs off on column mapping (separate follow-up sprint).
const SAMPLE_BILLS: BillRow[] = [
  { billId: "b1", billNo: "B-001", billedAt: "2026-04-15", customerStateCode: "27",
    taxablePaise: paise(100000), cgstPaise: paise(2500), sgstPaise: paise(2500),
    igstPaise: paise(0), cessPaise: paise(0), isRefund: false },
  { billId: "b2", billNo: "B-002", billedAt: "2026-04-16", customerStateCode: "27",
    taxablePaise: paise(50000), cgstPaise: paise(1250), sgstPaise: paise(1250),
    igstPaise: paise(0), cessPaise: paise(0), isRefund: false },
];
const SAMPLE_PURCHASES: PurchaseRow[] = [
  { grnId: "g1", invoiceNo: "INV-101", invoiceDate: "2026-04-10",
    supplierGstin: "27ABCDE1234F1Z5",
    taxablePaise: paise(50000), cgstPaise: paise(1250), sgstPaise: paise(1250),
    igstPaise: paise(0), cessPaise: paise(0), itcEligible: true },
];

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function periodToYyyymm(period: string): string {
  // Accepts "2026-04" or "2026-04-15"; strips to "2026-04".
  return /^\d{4}-\d{2}/.test(period) ? period.slice(0, 7) : period;
}

interface ReportsExportPanelProps {
  shopName?: string;
  period?: string;
  /** Shop scope. Defaults to "shop_local" (single-tenant pilot). */
  shopId?: string;
  /** When true, suppresses the GSTR-9 "Coming next sprint" badge for tests. */
  gstr9Available?: boolean;
}

export default function ReportsExportPanel({
  shopName = "PharmaCare",
  period = "2026-04",
  shopId = "shop_local",
  gstr9Available = false,
}: ReportsExportPanelProps = {}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const exportTallyXml = useCallback(() => {
    setBusy(true); setErr(null);
    try {
      const vouchers: TallyVoucher[] = SAMPLE_BILLS.filter((b) => !b.isRefund).map((b) =>
        billToSalesVoucher({
          billNo: b.billNo,
          billedAt: b.billedAt,
          customerLedgerName: "Walk-in Customer",
          grandTotalPaise: paise(
            (b.taxablePaise as number) + (b.cgstPaise as number) + (b.sgstPaise as number) +
            (b.igstPaise as number) + (b.cessPaise as number)
          ),
          cgstPaise: b.cgstPaise, sgstPaise: b.sgstPaise,
          igstPaise: b.igstPaise, cessPaise: b.cessPaise,
          salesLedgerName: "Sales — Pharmacy",
        })
      );
      downloadBlob(`tally_${period}.xml`, buildTallyXml(vouchers, shopName), "application/xml");
      setLast(`Tally Prime XML — ${vouchers.length} vouchers`);
    } finally { setBusy(false); }
  }, [period, shopName]);

  const exportZoho = useCallback(() => {
    setBusy(true); setErr(null);
    try {
      const vouchers: TallyVoucher[] = SAMPLE_BILLS.filter((b) => !b.isRefund).map((b) =>
        billToSalesVoucher({
          billNo: b.billNo,
          billedAt: b.billedAt,
          customerLedgerName: "Walk-in Customer",
          grandTotalPaise: paise((b.taxablePaise as number) + (b.cgstPaise as number) + (b.sgstPaise as number) + (b.igstPaise as number)),
          cgstPaise: b.cgstPaise, sgstPaise: b.sgstPaise, igstPaise: b.igstPaise, cessPaise: paise(0),
          salesLedgerName: "Sales",
        })
      );
      downloadBlob(`zoho_${period}.csv`, buildZohoBooksCsv(vouchers), "text/csv");
      setLast(`Zoho Books CSV — ${vouchers.length} rows`);
    } finally { setBusy(false); }
  }, [period]);

  const exportQbiif = useCallback(() => {
    setBusy(true); setErr(null);
    try {
      const vouchers: TallyVoucher[] = SAMPLE_BILLS.filter((b) => !b.isRefund).map((b) =>
        billToSalesVoucher({
          billNo: b.billNo,
          billedAt: b.billedAt,
          customerLedgerName: "Walk-in Customer",
          grandTotalPaise: paise((b.taxablePaise as number) + (b.cgstPaise as number) + (b.sgstPaise as number) + (b.igstPaise as number)),
          cgstPaise: b.cgstPaise, sgstPaise: b.sgstPaise, igstPaise: b.igstPaise, cessPaise: paise(0),
          salesLedgerName: "Sales",
        })
      );
      downloadBlob(`quickbooks_${period}.iif`, buildQuickBooksIIF(vouchers), "text/plain");
      setLast(`QuickBooks IIF — ${vouchers.length} vouchers`);
    } finally { setBusy(false); }
  }, [period]);

  // GSTR-3B — real IPC. Returns the canonical Gstr3b payload as JSON which the
  // user downloads. Replaces the in-browser SAMPLE_BILLS computation.
  const export3b = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const yyyymm = periodToYyyymm(period);
      const payload = await generateGstr3bPayloadRpc({ periodYyyymm: yyyymm, shopId });
      downloadBlob(`gstr3b_${yyyymm}.json`, JSON.stringify(payload, null, 2), "application/json");
      setLast(`GSTR-3B JSON · taxable ₹${payload.outwardSupplies.taxablePaise / 100}`);
    } catch (e) {
      setErr(`GSTR-3B generation failed: ${String(e)}`);
    } finally { setBusy(false); }
  }, [period, shopId]);

  const export2bRecon = useCallback(() => {
    setBusy(true); setErr(null);
    try {
      // demo portal data — production caller imports the JSON downloaded from GST portal
      const portal: Gstr2bPortalRow[] = SAMPLE_PURCHASES.map((p) => ({
        supplierGstin: p.supplierGstin, invoiceNo: p.invoiceNo, invoiceDate: p.invoiceDate,
        taxablePaise: p.taxablePaise, igstPaise: p.igstPaise,
        cgstPaise: p.cgstPaise, sgstPaise: p.sgstPaise, cessPaise: p.cessPaise,
      }));
      const recon = reconcile2b(SAMPLE_PURCHASES, portal);
      downloadBlob(`gstr2b_recon_${period}.json`, JSON.stringify(recon, null, 2), "application/json");
      const matchCount = recon.filter((r) => r.status === "match").length;
      setLast(`GSTR-2B reconcile · ${matchCount}/${recon.length} matched`);
    } finally { setBusy(false); }
  }, [period]);

  const export9 = useCallback(() => {
    setBusy(true); setErr(null);
    try {
      const monthly: Gstr3b = buildGstr3b({ period, shopId, bills: SAMPLE_BILLS, purchases: SAMPLE_PURCHASES });
      const annual = buildGstr9("2026-27", shopId, [monthly]);
      downloadBlob(`gstr9_2026-27.json`, JSON.stringify(annual, null, 2), "application/json");
      setLast(`GSTR-9 annual export — 1 month aggregated (sample)`);
    } finally { setBusy(false); }
  }, [period, shopId]);

  return (
    <Glass>
      <div className="p-4 flex flex-col gap-3" data-testid="reports-export-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={16} aria-hidden />
            <h2 className="font-medium">Accounting + GST exports</h2>
          </div>
          <Badge variant="neutral">period {period}</Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button onClick={exportTallyXml} disabled={busy}><FileSpreadsheet size={14} /> Tally Prime XML</Button>
          <Button onClick={exportZoho}     disabled={busy}><FileSpreadsheet size={14} /> Zoho Books CSV</Button>
          <Button onClick={exportQbiif}    disabled={busy}><FileSpreadsheet size={14} /> QuickBooks IIF</Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button onClick={export3b}      disabled={busy} data-testid="export-3b"><Receipt size={14} /> GSTR-3B summary</Button>
          <Button onClick={export2bRecon} disabled={busy}><Shield  size={14} /> GSTR-2B reconcile</Button>
          {gstr9Available ? (
            <Button onClick={export9} disabled={busy}><Receipt size={14} /> GSTR-9 annual</Button>
          ) : (
            <Button disabled className="opacity-70" data-testid="export-9-disabled">
              <Receipt size={14} /> GSTR-9 annual
              <Badge variant="warning">Coming next sprint</Badge>
            </Button>
          )}
        </div>

        {err && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--pc-state-danger)] border-t border-[var(--pc-border-subtle)] pt-2" data-testid="export-error">
            <AlertCircle size={12} /> {err}
          </div>
        )}
        {last && !err && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--pc-state-success)] border-t border-[var(--pc-border-subtle)] pt-2" data-testid="export-last">
            <CheckCircle2 size={12} /> Last export: {last}
          </div>
        )}
        <div className="flex items-start gap-2 text-[11px] text-[var(--pc-text-tertiary)]">
          <AlertCircle size={12} className="mt-0.5" />
          GSTR-3B is wired to live IPC. Tally / Zoho / QB / GSTR-2B / GSTR-9 still consume sample bills until their RPCs land.
        </div>
      </div>
    </Glass>
  );
}
