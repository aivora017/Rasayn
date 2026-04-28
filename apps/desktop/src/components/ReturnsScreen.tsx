/**
 * A10 — GSTR-1 Returns Screen (ADR 0015).
 *
 * Keyboard-first workflow (per ADR 0009):
 *   F9   → Generate GSTR-1 payload for selected period (local, pure TS)
 *   F10  → Download {MM}{YYYY}_GSTR1_{GSTIN}.json
 *   F2   → Download 6-CSV bundle (b2b, b2cl, b2cs, hsn, exemp, doc)
 *   F12  → Mark Filed (owner-role-only; flips status draft→filed,
 *          back-fills bills.filed_period so they are excluded from re-export)
 *
 * Flow: pick period → Generate (F9) pulls bills via generate_gstr1_payload Rust cmd,
 * feeds to pure-TS generateGstr1() → preview tabs (B2B/B2CL/B2CS/HSN/Exemp/Docs/Summary)
 * → save via save_gstr1_return (idempotent by hash) → optional Mark Filed.
 *
 * Tests: src/components/ReturnsScreen.test.tsx
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateGstr1,
  gstr1Filename,
  serialiseJson,
  type BillForGstr1,
  type BillLineForGstr1,
  type GenerateGstr1Input,
  type Gstr1Result,
} from "@pharmacare/gstr1";
import {
  generateGstr1PayloadRpc,
  saveGstr1ReturnRpc,
  listGstReturnsRpc,
  markGstr1FiledRpc,
  userGetRpc,
  listIrnRecordsRpc,
  cancelIrnRpc,
  listReturnsForBillRpc,
  type Gstr1InputDTO,
  type GstReturnDTO,
  type ReturnHeaderRowDTO,
  type SavePartialReturnResultDTO,
  type UserDTO,
  type IrnRecordDTO,
} from "../lib/ipc.js";
import { PartialReturnPicker } from "./PartialReturnPicker.js";

const SHOP_ID = "shop_vaidyanath_kalyan";
const OWNER_USER_ID = "user_sourav_owner";

type PreviewTab = "summary" | "b2b" | "b2cl" | "b2cs" | "hsn" | "exemp" | "doc";
type ReturnsMode = "gstr1" | "irn" | "refunds";
type IrnStatusFilter = "all" | "pending" | "submitted" | "acked" | "failed" | "cancelled";

function ymNow(): { mm: string; yyyy: string } {
  const d = new Date();
  // Default to previous month — returns are filed for the past period.
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return { mm, yyyy };
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function dtoToInput(dto: Gstr1InputDTO, mm: string, yyyy: string): GenerateGstr1Input {
  return {
    period: { mm, yyyy },
    shop: {
      id: dto.shop.id,
      gstin: dto.shop.gstin,
      stateCode: dto.shop.stateCode,
      name: dto.shop.name,
    },
    bills: dto.bills.map((b) => ({
      id: b.id,
      billNo: b.billNo,
      billedAt: b.billedAt,
      docSeries: b.docSeries,
      gstTreatment: b.gstTreatment as BillForGstr1["gstTreatment"],
      subtotalPaise: b.subtotalPaise,
      totalDiscountPaise: b.totalDiscountPaise,
      totalCgstPaise: b.totalCgstPaise,
      totalSgstPaise: b.totalSgstPaise,
      totalIgstPaise: b.totalIgstPaise,
      totalCessPaise: b.totalCessPaise,
      roundOffPaise: b.roundOffPaise,
      grandTotalPaise: b.grandTotalPaise,
      isVoided: b.isVoided === 1 ? 1 : 0,
      customer: b.customer
        ? {
            id: b.customer.id,
            gstin: b.customer.gstin,
            name: b.customer.name,
            stateCode: b.customer.stateCode,
            address: b.customer.address,
          }
        : null,
      lines: b.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        hsn: l.hsn,
        gstRate: l.gstRate as BillLineForGstr1["gstRate"],
        qty: l.qty,
        taxableValuePaise: l.taxableValuePaise,
        cgstPaise: l.cgstPaise,
        sgstPaise: l.sgstPaise,
        igstPaise: l.igstPaise,
        cessPaise: l.cessPaise,
        lineTotalPaise: l.lineTotalPaise,
      })),
    })),
  };
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function formatRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  return `${sign}₹${r.toLocaleString("en-IN")}.${String(p).padStart(2, "0")}`;
}

export function ReturnsScreen() {
  const init = useMemo(() => ymNow(), []);
  const [mm, setMm] = useState(init.mm);
  const [yyyy, setYyyy] = useState(init.yyyy);
  const [result, setResult] = useState<Gstr1Result | null>(null);
  const [savedReturn, setSavedReturn] = useState<GstReturnDTO | null>(null);
  const [history, setHistory] = useState<readonly GstReturnDTO[]>([]);
  const [currentUser, setCurrentUser] = useState<UserDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<PreviewTab>("summary");
  const [confirmFile, setConfirmFile] = useState(false);
  const periodRef = useRef<HTMLInputElement | null>(null);
  // A12 (ADR 0017) · IRN Records mode + filters
  const [mode, setMode] = useState<ReturnsMode>("gstr1");
  // A8 refunds-mode state (ADR 0021 step 7).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refundBillId, setRefundBillId] = useState("");
  const [refundHistory, setRefundHistory] = useState<readonly ReturnHeaderRowDTO[]>([]);
  const [refundLoadErr, setRefundLoadErr] = useState<string | null>(null);
  const [refundToast, setRefundToast] = useState<string | null>(null);
  const [irnRecords, setIrnRecords] = useState<readonly IrnRecordDTO[]>([]);
  const [irnFilter, setIrnFilter] = useState<IrnStatusFilter>("all");
  const [irnBusy, setIrnBusy] = useState(false);
  const [irnErr, setIrnErr] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<IrnRecordDTO | null>(null);
  const [cancelReasonCode, setCancelReasonCode] = useState<"1" | "2" | "3" | "4">("2");
  const [cancelRemarks, setCancelRemarks] = useState("");

  // Load current user + history on mount
  useEffect(() => {
    let live = true;
    void userGetRpc(OWNER_USER_ID).then((u) => { if (live) setCurrentUser(u); });
    void listGstReturnsRpc(SHOP_ID).then((h) => { if (live) setHistory(h); });
    return () => { live = false; };
  }, []);

  const refreshHistory = useCallback(async () => {
    const h = await listGstReturnsRpc(SHOP_ID);
    setHistory(h);
  }, []);

  // A12 · IRN list refresh (used on tab switch + filter change + after cancel).
  const refreshIrn = useCallback(async () => {
    setIrnBusy(true);
    setIrnErr(null);
    try {
      const status = irnFilter === "all" ? undefined : irnFilter;
      const rows = await listIrnRecordsRpc(SHOP_ID, status, 200);
      setIrnRecords(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setIrnErr(`Failed to load IRN records: ${msg}`);
    } finally {
      setIrnBusy(false);
    }
  }, [irnFilter]);

  const doCancelIrn = useCallback(async () => {
    if (!cancelTarget) return;
    if (!currentUser) {
      setIrnErr("User not loaded — cannot cancel IRN");
      return;
    }
    setIrnBusy(true);
    setIrnErr(null);
    try {
      const rem = cancelRemarks.trim();
      await cancelIrnRpc(rem
        ? {
            irnRecordId: cancelTarget.id,
            actorUserId: currentUser.id,
            cancelReason: cancelReasonCode,
            cancelRemarks: rem,
          }
        : {
            irnRecordId: cancelTarget.id,
            actorUserId: currentUser.id,
            cancelReason: cancelReasonCode,
          });
      setCancelTarget(null);
      setCancelRemarks("");
      await refreshIrn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setIrnErr(`Cancel failed: ${msg}`);
    } finally {
      setIrnBusy(false);
    }
  }, [cancelTarget, currentUser, cancelReasonCode, cancelRemarks, refreshIrn]);

  // Load IRN records on mode/filter change.
  useEffect(() => {
    if (mode !== "irn") return;
    let live = true;
    void refreshIrn().then(() => { /* state already set */ if (!live) return; });
    return () => { live = false; };
  }, [mode, refreshIrn]);

  const generate = useCallback(async () => {
    if (busy) return;
    if (!/^(0[1-9]|1[0-2])$/.test(mm) || !/^\d{4}$/.test(yyyy)) {
      setErr("Period invalid — expected MM=01-12, YYYY=4 digits");
      return;
    }
    setBusy(true);
    setErr(null);
    setSavedReturn(null);
    try {
      const period = `${mm}${yyyy}`;
      const dto = await generateGstr1PayloadRpc(SHOP_ID, period);
      const input = dtoToInput(dto, mm, yyyy);
      const r = generateGstr1(input);
      setResult(r);
      // Persist (idempotent by hash — same inputs → same row, no duplicate).
      const jsonStr = serialiseJson(r.json);
      const hash = await sha256Hex(jsonStr);
      const saved = await saveGstr1ReturnRpc({
        shopId: SHOP_ID,
        period,
        jsonBlob: jsonStr,
        csvB2b: r.csv.b2b,
        csvB2cl: r.csv.b2cl,
        csvB2cs: r.csv.b2cs,
        csvHsn: r.csv.hsn,
        csvExemp: r.csv.exemp,
        csvDoc: r.csv.doc,
        hashSha256: hash,
        billCount: r.summary.billCount,
        grandTotalPaise: r.summary.grandTotalPaise,
      });
      setSavedReturn(saved);
      await refreshHistory();
      setTab("summary");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, mm, yyyy, refreshHistory]);

  const downloadJson = useCallback(() => {
    if (!result) return;
    const name = gstr1Filename(mm, yyyy, result.json.gstin);
    downloadBlob(name, serialiseJson(result.json), "application/json");
  }, [result, mm, yyyy]);

  const downloadCsvBundle = useCallback(() => {
    if (!result) return;
    const base = `${mm}${yyyy}_GSTR1_${result.json.gstin}`;
    downloadBlob(`${base}_b2b.csv`, result.csv.b2b, "text/csv");
    downloadBlob(`${base}_b2cl.csv`, result.csv.b2cl, "text/csv");
    downloadBlob(`${base}_b2cs.csv`, result.csv.b2cs, "text/csv");
    downloadBlob(`${base}_hsn.csv`, result.csv.hsn, "text/csv");
    downloadBlob(`${base}_exemp.csv`, result.csv.exemp, "text/csv");
    downloadBlob(`${base}_doc.csv`, result.csv.doc, "text/csv");
  }, [result, mm, yyyy]);

  const markFiled = useCallback(async () => {
    if (!savedReturn || busy) return;
    if (!currentUser || currentUser.role !== "owner" || !currentUser.isActive) {
      setErr("Only an active owner can mark a return as Filed.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const updated = await markGstr1FiledRpc({
        returnId: savedReturn.id,
        actorUserId: currentUser.id,
      });
      setSavedReturn(updated);
      await refreshHistory();
      setConfirmFile(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [savedReturn, busy, currentUser, refreshHistory]);

  // F-key bindings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // F4 — flip to A8 refunds mode (always-on, regardless of current mode).
      if (e.key === "F4") {
        e.preventDefault();
        setMode("refunds");
        return;
      }
      // GSTR-1 keys are gated to the gstr1 panel.
      if (mode !== "gstr1") return;
      if (e.key === "F9") { e.preventDefault(); void generate(); }
      else if (e.key === "F10") { e.preventDefault(); downloadJson(); }
      else if (e.key === "F2") { e.preventDefault(); downloadCsvBundle(); }
      else if (e.key === "F12") {
        e.preventDefault();
        if (savedReturn && savedReturn.status === "draft") setConfirmFile(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, generate, downloadJson, downloadCsvBundle, savedReturn]);

  const summary = result?.summary ?? null;
  const isOwner = currentUser?.role === "owner" && currentUser.isActive;
  const canFile = !!savedReturn && savedReturn.status === "draft" && isOwner && !busy;

  return (
    <div className="mx-auto max-w-[1280px] p-4 lg:p-6 text-[var(--pc-text-primary)]" data-testid="returns-screen">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight">Returns &amp; GSTR-1</h1>
        <p className="text-[12px] text-[var(--pc-text-secondary)]">monthly export · IRN cancel · partial refunds</p>
        <div data-testid="ret-mode-switch" className="ml-auto inline-flex items-center gap-0.5 rounded-[var(--pc-radius-md)] bg-[var(--pc-bg-surface-2)] p-0.5">
          {(["gstr1", "irn", "refunds"] as ReturnsMode[]).map((m) => (
            <button
              key={m}
              data-testid={`ret-mode-${m}`}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={
                "rounded-[var(--pc-radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors " +
                (mode === m
                  ? "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)] shadow-[var(--pc-elevation-1)]"
                  : "text-[var(--pc-text-secondary)] hover:text-[var(--pc-text-primary)]")
              }
            >{m === "gstr1" ? "GSTR-1" : m === "irn" ? "IRN Records" : "Refunds (F4)"}</button>
          ))}
        </div>
      </header>

{mode === "gstr1" && (<>
      {/* Period + action row */}
      <div style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
          Month (MM)
          <input
            ref={periodRef}
            data-testid="ret-mm"
            value={mm}
            onChange={(e) => setMm(e.target.value.trim())}
            maxLength={2}
            style={{ padding: "6px 8px", width: 60, textAlign: "center" }}
          />
        </label>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
          Year (YYYY)
          <input
            data-testid="ret-yyyy"
            value={yyyy}
            onChange={(e) => setYyyy(e.target.value.trim())}
            maxLength={4}
            style={{ padding: "6px 8px", width: 80, textAlign: "center" }}
          />
        </label>
        <button
          data-testid="ret-generate"
          onClick={() => void generate()}
          disabled={busy}
          style={{ padding: "6px 14px", fontWeight: 500 }}
        >
          {busy ? "Generating…" : "Generate (F9)"}
        </button>
        <button
          data-testid="ret-dl-json"
          onClick={downloadJson}
          disabled={!result}
          style={{ padding: "6px 12px" }}
        >Download JSON (F10)</button>
        <button
          data-testid="ret-dl-csv"
          onClick={downloadCsvBundle}
          disabled={!result}
          style={{ padding: "6px 12px" }}
        >Download CSV bundle (F2)</button>
        <button
          data-testid="ret-file"
          onClick={() => setConfirmFile(true)}
          disabled={!canFile}
          title={!isOwner ? "Owner-only action" : (!savedReturn ? "Generate first" : savedReturn.status !== "draft" ? "Already filed" : "Mark Filed")}
          style={{ padding: "6px 12px", background: canFile ? "var(--pc-state-info)" : "var(--pc-text-tertiary)", color: "var(--pc-bg-surface)", border: "none" }}
        >Mark Filed (F12)</button>
      </div>

      {err && <div data-testid="ret-err" role="alert" style={{ color: "var(--pc-state-danger)", marginBottom: 10 }}>{err}</div>}

      {savedReturn && (
        <div data-testid="ret-saved-banner" style={{ marginBottom: 10, padding: "8px 12px", background: "var(--pc-state-success-bg)", border: "1px solid #9bc79b", fontSize: 13 }}>
          Return <strong>{savedReturn.returnType}</strong> for period <strong>{savedReturn.period}</strong> — status:{" "}
          <strong data-testid="ret-saved-status">{savedReturn.status}</strong>{" "}·{" "}
          {savedReturn.billCount} bills · total {formatRupees(savedReturn.grandTotalPaise)} ·
          hash <code>{savedReturn.hashSha256.slice(0, 12)}…</code>
        </div>
      )}

      {/* Preview tabs */}
      {result && (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {(["summary","b2b","b2cl","b2cs","hsn","exemp","doc"] as PreviewTab[]).map((t) => (
              <button
                key={t}
                data-testid={`ret-tab-${t}`}
                onClick={() => setTab(t)}
                style={{
                  padding: "4px 12px", fontSize: 13,
                  background: tab === t ? "var(--pc-state-info)" : "var(--pc-bg-surface-2)",
                  color: tab === t ? "var(--pc-bg-surface)" : "var(--pc-text-primary)",
                  border: "none", cursor: "pointer",
                }}
              >{t.toUpperCase()}</button>
            ))}
          </div>

          {tab === "summary" && summary && (
            <div data-testid="ret-preview-summary" style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div>Bills counted: <strong>{summary.billCount}</strong></div>
              <div>Grand total: <strong>{formatRupees(summary.grandTotalPaise)}</strong></div>
              <div>B2B invoices: {summary.b2bCount} · B2CL invoices: {summary.b2clCount} · B2CS rows: {summary.b2csRowCount}</div>
              <div>HSN rows (B2B / B2C): {summary.hsnB2bRowCount} / {summary.hsnB2cRowCount}</div>
              <div>Exempt rows: {summary.exempRowCount} · Doc rows: {summary.docRowCount}</div>
              {summary.gaps.length > 0 && (
                <div style={{ color: "var(--pc-state-warning)", marginTop: 6 }} data-testid="ret-gaps">
                  Doc-series gaps:{" "}
                  {summary.gaps.map((g) => `${g.series}: ${g.gapNums.join(",")}`).join(" · ")}
                </div>
              )}
              {summary.invalid.length > 0 && (
                <div style={{ color: "var(--pc-state-danger)", marginTop: 6 }} data-testid="ret-invalid">
                  Invalid bills ({summary.invalid.length}):{" "}
                  {summary.invalid.slice(0,5).map((i) => `${i.billId}(${i.reason})`).join(", ")}
                  {summary.invalid.length > 5 && ` +${summary.invalid.length - 5} more`}
                </div>
              )}
            </div>
          )}
          {tab === "b2b" && (
            <table data-testid="ret-preview-b2b" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: 4 }}>Buyer GSTIN</th><th>Invoices</th><th>Total taxable (₹)</th>
                </tr>
              </thead>
              <tbody>
                {result.json.b2b.map((bb) => {
                  const tv = bb.inv.reduce((s, inv) => s + inv.itms.reduce((ss, it) => ss + it.itm_det.txval, 0), 0);
                  return (
                    <tr key={bb.ctin}><td style={{ padding: 4 }}>{bb.ctin}</td><td>{bb.inv.length}</td><td>{tv.toFixed(2)}</td></tr>
                  );
                })}
                {result.json.b2b.length === 0 && <tr><td colSpan={3} style={{ padding: 6, color: "var(--pc-text-tertiary)" }}>No B2B invoices.</td></tr>}
              </tbody>
            </table>
          )}
          {tab === "b2cl" && (
            <table data-testid="ret-preview-b2cl" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: 4 }}>PoS</th><th>Invoices</th><th>Total value (₹)</th>
                </tr>
              </thead>
              <tbody>
                {result.json.b2cl.map((b) => {
                  const tv = b.inv.reduce((s, inv) => s + inv.val, 0);
                  return <tr key={b.pos}><td style={{ padding: 4 }}>{b.pos}</td><td>{b.inv.length}</td><td>{tv.toFixed(2)}</td></tr>;
                })}
                {result.json.b2cl.length === 0 && <tr><td colSpan={3} style={{ padding: 6, color: "var(--pc-text-tertiary)" }}>No B2CL invoices.</td></tr>}
              </tbody>
            </table>
          )}
          {tab === "b2cs" && (
            <table data-testid="ret-preview-b2cs" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: 4 }}>PoS</th><th>Rate</th><th>Taxable (₹)</th><th>IGST (₹)</th><th>CGST (₹)</th><th>SGST (₹)</th>
                </tr>
              </thead>
              <tbody>
                {result.json.b2cs.map((r, i) => (
                  <tr key={i}><td style={{ padding: 4 }}>{r.pos}</td><td>{r.rt}%</td><td>{r.txval.toFixed(2)}</td><td>{r.iamt.toFixed(2)}</td><td>{r.camt.toFixed(2)}</td><td>{r.samt.toFixed(2)}</td></tr>
                ))}
                {result.json.b2cs.length === 0 && <tr><td colSpan={6} style={{ padding: 6, color: "var(--pc-text-tertiary)" }}>No B2CS rows.</td></tr>}
              </tbody>
            </table>
          )}
          {tab === "hsn" && (
            <table data-testid="ret-preview-hsn" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: 4 }}>Split</th><th>HSN</th><th>Rate</th><th>Qty</th><th>Taxable (₹)</th>
                </tr>
              </thead>
              <tbody>
                {result.json.hsn.hsn_b2b.data.map((r, i) => (
                  <tr key={`b2b-${i}`}><td style={{ padding: 4 }}>B2B</td><td>{r.hsn_sc}</td><td>{r.rt}%</td><td>{r.qty}</td><td>{r.txval.toFixed(2)}</td></tr>
                ))}
                {result.json.hsn.hsn_b2c.data.map((r, i) => (
                  <tr key={`b2c-${i}`}><td style={{ padding: 4 }}>B2C</td><td>{r.hsn_sc}</td><td>{r.rt}%</td><td>{r.qty}</td><td>{r.txval.toFixed(2)}</td></tr>
                ))}
                {result.json.hsn.hsn_b2b.data.length + result.json.hsn.hsn_b2c.data.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 6, color: "var(--pc-text-tertiary)" }}>No HSN rows.</td></tr>
                )}
              </tbody>
            </table>
          )}
          {tab === "exemp" && (
            <table data-testid="ret-preview-exemp" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: 4 }}>Supply type</th><th>Nil-rated (₹)</th><th>Exempted (₹)</th><th>Non-GST (₹)</th>
                </tr>
              </thead>
              <tbody>
                {result.json.nil.inv.map((r, i) => (
                  <tr key={i}><td style={{ padding: 4 }}>{r.sply_ty}</td><td>{r.nil_amt.toFixed(2)}</td><td>{r.expt_amt.toFixed(2)}</td><td>{r.ngsup_amt.toFixed(2)}</td></tr>
                ))}
                {result.json.nil.inv.length === 0 && <tr><td colSpan={4} style={{ padding: 6, color: "var(--pc-text-tertiary)" }}>No exempt rows.</td></tr>}
              </tbody>
            </table>
          )}
          {tab === "doc" && (
            <table data-testid="ret-preview-doc" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: 4 }}>From</th><th>To</th><th>Total</th><th>Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {result.json.doc_issue.doc_det[0]?.docs.map((d, i) => (
                  <tr key={i}><td style={{ padding: 4 }}>{d.from}</td><td>{d.to}</td><td>{d.totnum}</td><td>{d.cancel}</td></tr>
                )) ?? null}
                {(result.json.doc_issue.doc_det[0]?.docs.length ?? 0) === 0 && (
                  <tr><td colSpan={4} style={{ padding: 6, color: "var(--pc-text-tertiary)" }}>No doc rows.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* History */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Prior returns</h3>
        <table data-testid="ret-history" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
              <th style={{ padding: 4 }}>Period</th><th>Type</th><th>Status</th><th>Bills</th><th>Total</th><th>Generated</th><th>Filed</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: 4 }}>{h.period}</td><td>{h.returnType}</td>
                <td>{h.status}</td><td>{h.billCount}</td><td>{formatRupees(h.grandTotalPaise)}</td>
                <td>{h.generatedAt}</td><td>{h.filedAt ?? "—"}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={7} style={{ padding: 6, color: "var(--pc-text-tertiary)" }}>No prior returns.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* File-confirm modal */}
      {confirmFile && savedReturn && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm mark filed"
          data-testid="ret-confirm-file"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ background: "var(--pc-bg-surface)", padding: 20, borderRadius: 4, minWidth: 360 }}>
            <h3 style={{ margin: "0 0 8px" }}>Mark GSTR-1 {savedReturn.period} as Filed?</h3>
            <p style={{ fontSize: 13, color: "var(--pc-text-secondary)" }}>
              This back-fills <code>filed_period</code> on the {savedReturn.billCount} bill(s) in this return,
              locking them against re-export. Action is audit-logged to <strong>{currentUser?.name ?? "?"}</strong>.
            </p>
            {!isOwner && (
              <div style={{ color: "var(--pc-state-danger)", fontSize: 13, marginBottom: 8 }} data-testid="ret-file-forbidden">
                Owner role required. Current user is not an active owner.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button data-testid="ret-file-cancel" onClick={() => setConfirmFile(false)}>Cancel</button>
              <button
                data-testid="ret-file-confirm"
                onClick={() => void markFiled()}
                disabled={!isOwner || busy}
                style={{ background: "var(--pc-state-info)", color: "var(--pc-bg-surface)", border: "none", padding: "6px 12px" }}
              >Confirm Mark Filed</button>
            </div>
          </div>
        </div>
      )}
</>)}

      {mode === "irn" && (
        <div data-testid="irn-panel">
          <div style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 12, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
              Status
              <select
                data-testid="irn-filter"
                value={irnFilter}
                onChange={(e) => setIrnFilter(e.target.value as IrnStatusFilter)}
                style={{ padding: "6px 8px" }}
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="acked">Acked</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <button
              data-testid="irn-refresh"
              onClick={() => void refreshIrn()}
              disabled={irnBusy}
              style={{ padding: "6px 14px" }}
            >{irnBusy ? "Loading…" : "Refresh"}</button>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--pc-text-secondary)" }}>
              {irnRecords.length} records
            </span>
          </div>

          {irnErr && (
            <div data-testid="irn-err" role="alert" style={{ color: "var(--pc-state-danger)", marginBottom: 10 }}>{irnErr}</div>
          )}

          <table data-testid="irn-table" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                <th style={{ padding: 6 }}>Bill</th>
                <th style={{ padding: 6 }}>Status</th>
                <th style={{ padding: 6 }}>IRN</th>
                <th style={{ padding: 6 }}>Vendor</th>
                <th style={{ padding: 6 }}>Attempts</th>
                <th style={{ padding: 6 }}>Submitted</th>
                <th style={{ padding: 6 }}>Ack</th>
                <th style={{ padding: 6 }}>Error</th>
                <th style={{ padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {irnRecords.map((r) => (
                <tr key={r.id} data-testid={`irn-row-${r.id}`} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 6 }}><code>{r.billId.slice(0, 14)}…</code></td>
                  <td style={{ padding: 6 }} data-irn-status={r.status}>
                    <span style={{
                      padding: "2px 6px",
                      borderRadius: 3,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: "var(--pc-bg-surface)",
                      background: r.status === "acked" ? "var(--pc-state-success)"
                        : r.status === "failed" ? "var(--pc-state-danger)"
                        : r.status === "cancelled" ? "var(--pc-text-secondary)"
                        : r.status === "submitted" ? "var(--pc-state-info)"
                        : "var(--pc-state-warning)",
                    }}>{r.status}</span>
                  </td>
                  <td style={{ padding: 6, fontFamily: "monospace", fontSize: 11 }}>
                    {r.irn ? `${r.irn.slice(0, 8)}…${r.irn.slice(-6)}` : "—"}
                  </td>
                  <td style={{ padding: 6 }}>{r.vendor}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{r.attemptCount}</td>
                  <td style={{ padding: 6 }}>{r.submittedAt ? r.submittedAt.slice(0, 19).replace("T", " ") : "—"}</td>
                  <td style={{ padding: 6 }}>{r.ackDate ? r.ackDate.slice(0, 19).replace("T", " ") : "—"}</td>
                  <td style={{ padding: 6, color: "var(--pc-state-danger)" }}>
                    {r.errorMsg ? `${r.errorCode ?? ""} ${r.errorMsg}`.trim() : ""}
                  </td>
                  <td style={{ padding: 6 }}>
                    {(r.status === "submitted" || r.status === "acked") && (
                      <button
                        data-testid={`irn-cancel-${r.id}`}
                        onClick={() => { setCancelTarget(r); setCancelRemarks(""); setCancelReasonCode("2"); }}
                        style={{ padding: "3px 10px", background: "var(--pc-state-danger)", color: "var(--pc-bg-surface)", border: "none", fontSize: 11 }}
                      >Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {irnRecords.length === 0 && !irnBusy && (
                <tr><td colSpan={9} style={{ padding: 12, color: "var(--pc-text-secondary)", textAlign: "center" }}>
                  No IRN records for this filter.
                </td></tr>
              )}
            </tbody>
          </table>

          {cancelTarget && (
            <div
              data-testid="irn-cancel-dialog"
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
              }}
            >
              <div style={{ background: "var(--pc-bg-surface)", padding: 20, borderRadius: 6, minWidth: 400, maxWidth: 520 }}>
                <h3 style={{ marginTop: 0 }}>Cancel IRN</h3>
                <p style={{ fontSize: 13, color: "var(--pc-border-subtle)" }}>
                  Bill <code>{cancelTarget.billId}</code> — current status <strong>{cancelTarget.status}</strong>
                </p>
                <label style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
                  Reason
                  <select
                    data-testid="irn-cancel-reason"
                    value={cancelReasonCode}
                    onChange={(e) => setCancelReasonCode(e.target.value as "1"|"2"|"3"|"4")}
                    style={{ display: "block", marginTop: 4, padding: "4px 6px", width: "100%" }}
                  >
                    <option value="1">1 — Duplicate</option>
                    <option value="2">2 — Data entry mistake</option>
                    <option value="3">3 — Order cancelled</option>
                    <option value="4">4 — Other</option>
                  </select>
                </label>
                <label style={{ display: "block", fontSize: 12, marginBottom: 12 }}>
                  Remarks (optional)
                  <input
                    data-testid="irn-cancel-remarks"
                    value={cancelRemarks}
                    onChange={(e) => setCancelRemarks(e.target.value)}
                    style={{ display: "block", marginTop: 4, padding: "4px 6px", width: "100%" }}
                  />
                </label>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    data-testid="irn-cancel-close"
                    onClick={() => setCancelTarget(null)}
                    style={{ padding: "6px 14px" }}
                  >Close</button>
                  <button
                    data-testid="irn-cancel-confirm"
                    onClick={() => void doCancelIrn()}
                    disabled={irnBusy}
                    style={{ padding: "6px 14px", background: "var(--pc-state-danger)", color: "var(--pc-bg-surface)", border: "none" }}
                  >Confirm Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "refunds" && (
        <div data-testid="refunds-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
              Bill ID (paste or type)
              <input
                data-testid="refund-bill-id"
                value={refundBillId}
                onChange={(e) => setRefundBillId(e.target.value.trim())}
                onKeyDown={async (e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (!refundBillId) return;
                  setRefundLoadErr(null);
                  try {
                    const rows = await listReturnsForBillRpc(refundBillId);
                    setRefundHistory(rows);
                  } catch (err) {
                    setRefundLoadErr(err instanceof Error ? err.message : String(err));
                    setRefundHistory([]);
                  }
                }}
                style={{ padding: "6px 8px", width: 320, fontFamily: "monospace", fontSize: 13 }}
                placeholder="bill_..."
              />
            </label>
            <button
              data-testid="refund-open-picker"
              onClick={() => setPickerOpen(true)}
              style={{ padding: "8px 14px", background: "var(--pc-state-info)", color: "var(--pc-bg-surface)", fontWeight: 600, border: "none" }}
            >Open partial-refund picker</button>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--pc-text-secondary)" }}>
              {refundHistory.length} prior refund{refundHistory.length === 1 ? "" : "s"} on this bill
            </span>
          </div>

          {refundLoadErr && (
            <div data-testid="refund-load-err" role="alert" style={{ color: "var(--pc-state-danger)" }}>{refundLoadErr}</div>
          )}
          {refundToast && (
            <div data-testid="refund-toast" role="status" style={{
              background: "var(--pc-state-success-bg)", color: "var(--pc-state-success)", padding: "8px 12px",
              borderRadius: 4, fontWeight: 600,
            }}>{refundToast}</div>
          )}

          {refundHistory.length === 0 && !refundLoadErr && (
            <div style={{ color: "var(--pc-text-secondary)", fontSize: 13 }}>
              Enter a bill ID and press Enter to load this bill&apos;s refund history,
              or press F4 in BillingScreen to launch the picker directly.
            </div>
          )}

          {refundHistory.length > 0 && (
            <table data-testid="refund-history-table" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: 6 }}>CN No</th>
                  <th style={{ padding: 6 }}>Type</th>
                  <th style={{ padding: 6 }}>Reason</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Refund</th>
                  <th style={{ padding: 6 }}>IRN</th>
                  <th style={{ padding: 6 }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {refundHistory.map((r) => (
                  <tr key={r.id} data-testid={`refund-row-${r.id}`} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: 6 }}>{r.returnNo}</td>
                    <td style={{ padding: 6 }}>{r.returnType}</td>
                    <td style={{ padding: 6 }}>{r.reason}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>₹{(r.refundTotalPaise / 100).toFixed(2)}</td>
                    <td style={{ padding: 6, fontFamily: "monospace", fontSize: 11 }}>
                      {r.creditNoteIrn ? `${r.creditNoteIrn.slice(0, 8)}…` : "—"}
                    </td>
                    <td style={{ padding: 6 }}>{r.createdAt.slice(0, 19).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <PartialReturnPicker
        open={pickerOpen}
        shopId={SHOP_ID}
        actorUserId={OWNER_USER_ID}
        onSaved={async (result: SavePartialReturnResultDTO) => {
          setPickerOpen(false);
          setRefundToast(`Refund saved · CN ₹${(result.refundTotalPaise / 100).toFixed(2)}`);
          // If the picker was driven from this screen, refresh the history.
          if (refundBillId) {
            try {
              const rows = await listReturnsForBillRpc(refundBillId);
              setRefundHistory(rows);
            } catch {
              // non-fatal
            }
          }
          // Auto-clear toast after 3s.
          setTimeout(() => setRefundToast(null), 3000);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </div>
  );
}
