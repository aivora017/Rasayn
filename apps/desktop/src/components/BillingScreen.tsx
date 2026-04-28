import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { formatINR, type Paise, type GstRate } from "@pharmacare/shared-types";
import { computeLine, computeInvoice, inferTreatment } from "@pharmacare/gst-engine";
import { ProductSearch } from "./ProductSearch.js";
import { PaymentModal } from "./PaymentModal.js";
import { OwnerOverrideModal, type ExpiryOverrideTarget } from "./OwnerOverrideModal.js";
import {
  pickFefoBatchRpc, listFefoCandidatesRpc, saveBillRpc,
  searchCustomersRpc, listPrescriptionsRpc, createPrescriptionRpc, upsertDoctorRpc,
  userGetRpc,
  getBillFullRpc, recordPrintRpc,
  submitIrnRpc, retryIrnRpc, getIrnForBillRpc,
  type ProductHit, type BatchPick, type SaveBillInput,
  type Customer, type Prescription, type Tender, type UserDTO,
  type ExpiryOverrideResultDTO,
  type IrnRecordDTO,
} from "../lib/ipc.js";
import { renderInvoiceHtml, resolveLayout } from "@pharmacare/invoice-print";

// A9 (ADR 0014) · Hidden-iframe print. The rendered HTML contains an inline
// `window.print()` bootstrap so the cashier sees the system print dialog the
// instant the iframe loads. The iframe stays attached briefly (the dialog is
// modal on most OSes) and is then removed to avoid DOM leaks.
function openPrintIframe(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  setTimeout(() => {
    try { document.body.removeChild(iframe); } catch { /* already gone */ }
  }, 60_000);
}

const RX_REQUIRED = new Set(["H", "H1", "X", "NDPS"]);

// A13 (ADR 0013) · Expiry thresholds. Warn amber at 90d, red at 30d; block
// hard at 0d. These are mirrored in the chip rendering below.
const EXPIRY_RED_DAYS = 30;
const EXPIRY_AMBER_DAYS = 90;

function daysBetweenIso(todayIso: string, futureIso: string): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.parse(todayIso + "T00:00:00Z");
  const b = Date.parse(futureIso + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / MS_PER_DAY);
}

interface DraftLine {
  readonly id: string;
  readonly productId: string | null;
  readonly name: string;
  readonly mrpPaise: Paise;
  readonly qty: number;
  readonly gstRate: GstRate;
  readonly discountPct: number;
  readonly batch: BatchPick | null;
  readonly schedule: string;
}

const SHOP = {
  id: "shop_vaidyanath_kalyan",
  stateCode: "27",
  cashierId: "user_sourav_owner",
};

type Toast = { kind: "ok" | "err"; msg: string } | null;

function genBillNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const hms = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  return `B-${ymd}-${hms}`;
}

export function BillingScreen() {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  // A9 (ADR 0014) · F9 re-prints the most recently saved bill. Reset on F1.
  const [lastSavedBillId, setLastSavedBillId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  // A12 (ADR 0017) · IRN chip — reflects e-invoice state of the last saved bill.
  const [irnRecord, setIrnRecord] = useState<IrnRecordDTO | null>(null);
  const [submittingIrn, setSubmittingIrn] = useState(false);

  // A13 · Expiry override state. `overrideTarget` drives the modal; the
  // resolved `ExpiryOverrideResultDTO` is stashed on the line to prove to the
  // save-time re-check that we don't need to re-prompt.
  const [currentUser, setCurrentUser] = useState<UserDTO | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<ExpiryOverrideTarget | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  // A6 · F7 batch override (ADR 0010 §2) — targets last-added line.
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);
  const [batchCandidates, setBatchCandidates] = useState<readonly BatchPick[]>([]);
  const [batchSelectedIdx, setBatchSelectedIdx] = useState(0);
  const [batchTargetIdx, setBatchTargetIdx] = useState<number | null>(null);
  const batchConfirmRef = useRef<HTMLButtonElement | null>(null);

  const [custQuery, setCustQuery] = useState("");
  const [custHits, setCustHits] = useState<readonly Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [rxList, setRxList] = useState<readonly Prescription[]>([]);
  const [rxId, setRxId] = useState<string | null>(null);
  const [newRxOpen, setNewRxOpen] = useState(false);
  const [newDoctorReg, setNewDoctorReg] = useState("");
  const [newDoctorName, setNewDoctorName] = useState("");
  const [newRxDate, setNewRxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newRxNotes, setNewRxNotes] = useState("");

  // Refs for keyboard-driven focus contract (A5).
  const custSearchRef = useRef<HTMLInputElement | null>(null);
  const lineDiscountRefs = useRef<Array<HTMLInputElement | null>>([]);

  // ProductSearch encapsulates its own input ref (autoFocus on mount). To
  // re-focus it from outside (F1 reset, F3 add-line), we resolve it by data-testid.
  const focusProductSearch = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="product-search"]');
    el?.focus();
    el?.select();
  }, []);

  // A13 · Load acting user on mount so role gating (owner-only override) is
  // available immediately. Falls back to null if the seed user row is absent —
  // the override modal explicitly surfaces this (role-warn banner).
  useEffect(() => {
    let live = true;
    void userGetRpc(SHOP.cashierId).then((u) => { if (live) setCurrentUser(u); });
    return () => { live = false; };
  }, []);



  const rxRequired = useMemo(() => lines.some((l) => RX_REQUIRED.has(l.schedule)), [lines]);

  // When rxRequired turns off (last H-line removed) and the user hadn't
  // explicitly chosen a customer for this bill, leave the customer state
  // intact — the A5 customer bar is always available.
  useEffect(() => {
    if (!rxRequired) { setRxId(null); setRxList([]); setNewRxOpen(false); }
  }, [rxRequired]);

  // Debounced customer hit list — runs whenever the customer bar is typed into.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!custQuery.trim()) { setCustHits([]); return; }
      setCustHits(await searchCustomersRpc(SHOP.id, custQuery, 8));
    }, 120);
    return () => clearTimeout(t);
  }, [custQuery]);

  const pickCustomer = useCallback(async (c: Customer) => {
    setCustomer(c);
    setCustHits([]);
    setCustQuery(c.name);
    setRxList(await listPrescriptionsRpc(c.id));
    setRxId(null);
  }, []);

  const saveNewRx = useCallback(async () => {
    if (!customer) return;
    try {
      let doctorId: string | null = null;
      if (newDoctorReg.trim() && newDoctorName.trim()) {
        doctorId = await upsertDoctorRpc({ regNo: newDoctorReg.trim(), name: newDoctorName.trim() });
      }
      const id = await createPrescriptionRpc({
        shopId: SHOP.id, customerId: customer.id,
        doctorId, kind: "paper", issuedDate: newRxDate,
        notes: newRxNotes || null,
      });
      const refreshed = await listPrescriptionsRpc(customer.id);
      setRxList(refreshed);
      setRxId(id);
      setNewRxOpen(false);
      setNewDoctorReg(""); setNewDoctorName(""); setNewRxNotes("");
      setToast({ kind: "ok", msg: "Rx captured" });
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  }, [customer, newDoctorReg, newDoctorName, newRxDate, newRxNotes]);

  const onPick = useCallback(async (h: ProductHit) => {
    const batch = await pickFefoBatchRpc(h.id);

    // A13 · Compute days-to-expiry client-side for the FEFO batch. Expired =>
    // hard-block, toast, do not add the line. Near-expiry (<=30d) => add the
    // line AND open the owner override modal so save_bill will accept it.
    if (batch) {
      const today = new Date().toISOString().slice(0, 10);
      const days = daysBetweenIso(today, batch.expiryDate);
      if (Number.isFinite(days) && days <= 0) {
        setToast({
          kind: "err",
          msg: `Cannot sell ${h.name}: batch ${batch.batchNo} expired on ${batch.expiryDate}. Mark for return-to-supplier.`,
        });
        return;
      }
    }

    setLines((prev) => [
      ...prev,
      {
        id: `l_${Date.now()}_${prev.length}`,
        productId: h.id,
        name: h.name,
        mrpPaise: (batch?.mrpPaise ?? h.mrpPaise) as Paise,
        qty: 1,
        gstRate: h.gstRate,
        discountPct: 0,
        batch,
        schedule: h.schedule,
      },
    ]);

    // A13 · If the FEFO batch is within 1..=30 days of expiry, require an
    // owner override before the bill can be saved. The modal's success handler
    // sets an audit row server-side; save_bill will match on (batch, cashier,
    // last 10 min).
    if (batch) {
      const today = new Date().toISOString().slice(0, 10);
      const days = daysBetweenIso(today, batch.expiryDate);
      if (Number.isFinite(days) && days > 0 && days <= EXPIRY_RED_DAYS) {
        setOverrideTarget({
          batchId: batch.id,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          daysToExpiry: days,
          productName: h.name,
        });
        setOverrideOpen(true);
      }
    }
  }, []);

  // A13 · Override callbacks. onOverride: record the audit_id (handy for the
  // future "show me who approved" audit drill-down) and close the modal.
  // onOverrideCancel: remove the offending line so the cashier cannot proceed
  // to save with a near-expiry batch and no audit row.
  const onOverrideDone = useCallback((result: ExpiryOverrideResultDTO) => {
    setOverrideOpen(false);
    setToast({
      kind: "ok",
      msg: `Owner override recorded (audit ${result.auditId}).`,
    });
    setOverrideTarget(null);
    focusProductSearch();
  }, [focusProductSearch]);

  const onOverrideCancel = useCallback(() => {
    setOverrideOpen(false);
    // Strip the last line (the one that triggered the modal) so save is blocked.
    setLines((prev) => prev.slice(0, -1));
    setOverrideTarget(null);
    setToast({
      kind: "err",
      msg: "Near-expiry line removed — owner override required to sell this batch.",
    });
    focusProductSearch();
  }, [focusProductSearch]);

  const computed = useMemo(() => {
    const treatment = inferTreatment("27", null, false);
    const taxed = lines
      .filter((l) => l.productId && l.mrpPaise > 0 && l.qty > 0)
      .map((l) => computeLine({
        mrpPaise: l.mrpPaise, qty: l.qty, gstRate: l.gstRate, discountPct: l.discountPct,
      }, treatment));
    return { taxed, totals: computeInvoice(taxed) };
  }, [lines]);

  const canSave = !saving
    && lines.some((l) => l.productId && l.batch && l.qty > 0)
    && (!rxRequired || (customer !== null && rxId !== null));

  const resetBill = useCallback(() => {
    setLines([]);
    setLastSavedBillId(null);
    setCustomer(null);
    setCustQuery("");
    setCustHits([]);
    setRxId(null);
    setRxList([]);
    setNewRxOpen(false);
    setNewDoctorReg("");
    setNewDoctorName("");
    setNewRxNotes("");
    setPaymentOpen(false);
    setToast(null);
    // Focus the primary input — the keyboard-first entry point.
    focusProductSearch();
    setIrnRecord(null);
  }, []);

  const doSave = useCallback(async (tenders?: readonly Tender[]) => {
    if (!canSave) return;
    const resolvedMode: SaveBillInput["paymentMode"] =
      !tenders || tenders.length === 0 ? "cash"
        : tenders.length === 1 ? tenders[0]!.mode
          : "split";
    const payload: SaveBillInput = {
      shopId: SHOP.id,
      billNo: genBillNo(),
      cashierId: SHOP.cashierId,
      paymentMode: resolvedMode,
      customerStateCode: SHOP.stateCode,
      customerId: customer?.id ?? null,
      rxId: rxId,
      lines: lines
        .filter((l) => l.productId && l.batch && l.qty > 0)
        .map((l) => ({
          productId: l.productId!,
          batchId: l.batch!.id,
          mrpPaise: l.mrpPaise,
          qty: l.qty,
          gstRate: l.gstRate,
          discountPct: l.discountPct,
        })),
      ...(tenders && tenders.length > 0 ? { tenders } : {}),
    };
    const billId = `bill_${Date.now()}`;
    setSaving(true);
    try {
      const r = await saveBillRpc(billId, payload);
      setLastSavedBillId(billId);
      // A12 · IRN chip starts empty; user clicks "Submit to IRP" to create it.
      setIrnRecord(null);
      setToast({ kind: "ok", msg: `Saved · ${payload.billNo} · ${formatINR(r.grandTotalPaise as Paise)} · F9 to print` });
      setLines([]);
      setCustomer(null); setRxId(null); setCustQuery(""); setRxList([]);
      setPaymentOpen(false);
      focusProductSearch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "err", msg: `Save failed: ${msg}` });
    } finally {
      setSaving(false);
    }
  }, [canSave, lines, customer, rxId]);


  // A12 (ADR 0017) · Submit bill to e-invoice IRP, or retry a failed submission.
  const submitIrn = useCallback(async () => {
    if (!lastSavedBillId) {
      setToast({ kind: "err", msg: "No bill to submit — save one first (F10)" });
      return;
    }
    if (!currentUser) {
      setToast({ kind: "err", msg: "User not loaded — cannot submit IRN" });
      return;
    }
    if (submittingIrn) return;
    setSubmittingIrn(true);
    try {
      const rec = await submitIrnRpc({ billId: lastSavedBillId, actorUserId: currentUser.id });
      setIrnRecord(rec);
      if (rec.status === "acked") {
        setToast({ kind: "ok", msg: `IRN acked · ${rec.irn ?? "(no irn)"}` });
      } else if (rec.status === "failed") {
        setToast({ kind: "err", msg: `IRN failed · ${rec.errorMsg ?? rec.errorCode ?? "unknown"}` });
      } else {
        setToast({ kind: "ok", msg: `IRN · ${rec.status}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "err", msg: `IRN submit failed: ${msg}` });
    } finally {
      setSubmittingIrn(false);
    }
  }, [lastSavedBillId, currentUser, submittingIrn]);

  const retryIrn = useCallback(async () => {
    if (!lastSavedBillId || !currentUser || submittingIrn) return;
    setSubmittingIrn(true);
    try {
      const rec = await retryIrnRpc(lastSavedBillId, currentUser.id);
      setIrnRecord(rec);
      setToast({
        kind: rec.status === "acked" ? "ok" : rec.status === "failed" ? "err" : "ok",
        msg: `IRN · ${rec.status}${rec.errorMsg ? ` · ${rec.errorMsg}` : ""}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "err", msg: `IRN retry failed: ${msg}` });
    } finally {
      setSubmittingIrn(false);
    }
  }, [lastSavedBillId, currentUser, submittingIrn]);

  // A9 (ADR 0014) · F9 reprint — fetch full bill, write print_audit,
  // render the invoice HTML, and hand it to a hidden iframe for browser-native
  // print. First call is ORIGINAL, subsequent calls show DUPLICATE — REPRINT.
  const doPrint = useCallback(async () => {
    if (!lastSavedBillId) {
      setToast({ kind: "err", msg: "No bill to print — save one first (F10)" });
      return;
    }
    if (!currentUser) {
      setToast({ kind: "err", msg: "User not loaded — cannot stamp print audit" });
      return;
    }
    if (printing) return;
    setPrinting(true);
    try {
      const bill = await getBillFullRpc(lastSavedBillId);
      const layout = resolveLayout(bill);
      const receipt = await recordPrintRpc({
        billId: lastSavedBillId,
        layout,
        actorUserId: currentUser.id,
      });
      const html = renderInvoiceHtml({ bill, layout, printReceipt: receipt });
      openPrintIframe(html);
      setToast({
        kind: "ok",
        msg: receipt.isDuplicate
          ? `Reprint #${receipt.printCount} · ${layout === "a5_gst" ? "A5 GST" : "Thermal 80mm"}`
          : `Printing · ${layout === "a5_gst" ? "A5 GST" : "Thermal 80mm"}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "err", msg: `Print failed: ${msg}` });
    } finally {
      setPrinting(false);
    }
  }, [lastSavedBillId, currentUser, printing]);

  // A5 keyboard shell — window-level so F-keys work from any focused element
  // inside the billing screen, including the embedded ProductSearch dropdown.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Only fire when Alt is not held, so App's Alt+digit nav is never stolen.
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (e.key === "F1") {
        e.preventDefault();
        resetBill();
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        custSearchRef.current?.focus();
        custSearchRef.current?.select();
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        focusProductSearch();
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        const last = lineDiscountRefs.current[lines.length - 1];
        if (last) { last.focus(); last.select(); }
        return;
      }
      if (e.key === "F6") {
        e.preventDefault();
        if (!canSave) {
          setToast({ kind: "err", msg: "Nothing to pay — add a line first" });
          return;
        }
        setPaymentOpen(true);
        return;
      }
      if (e.key === "F7") {
        e.preventDefault();
        if (lines.length === 0) {
          setToast({ kind: "err", msg: "Add a line first — F7 targets the last line" });
          return;
        }
        const target = lines.length - 1;
        const targetLine = lines[target];
        if (!targetLine?.productId) {
          setToast({ kind: "err", msg: "Last line has no product — nothing to override" });
          return;
        }
        void (async () => {
          try {
            const cs = await listFefoCandidatesRpc(targetLine.productId!);
            setBatchCandidates(cs);
            setBatchSelectedIdx(0);
            setBatchTargetIdx(target);
            setBatchPickerOpen(true);
          } catch (err) {
            setToast({ kind: "err", msg: `Batch list failed: ${String(err)}` });
          }
        })();
        return;
      }
      if (e.key === "F9") {
        // PaymentModal should not swallow F9 — print is available post-save only.
        if (paymentOpen) return;
        e.preventDefault();
        void doPrint();
        return;
      }
      if (e.key === "F10") {
        // When PaymentModal is open, its own window handler intercepts F10.
        if (paymentOpen) return;
        e.preventDefault();
        void doSave();
        return;
      }
      if (e.key === "Escape") {
        // PaymentModal handles its own Esc; fall through only for other toasts.
        if (paymentOpen) return;
        if (toast) { setToast(null); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doSave, doPrint, resetBill, canSave, paymentOpen, toast, lines]);

  // A6 · autofocus the batch-override confirm button on open (ADR 0010 §2).
  useEffect(() => {
    if (batchPickerOpen) batchConfirmRef.current?.focus();
  }, [batchPickerOpen]);

  const closeBatchPicker = useCallback(() => {
    setBatchPickerOpen(false);
    setBatchCandidates([]);
    setBatchTargetIdx(null);
    setBatchSelectedIdx(0);
  }, []);

  const commitBatchPick = useCallback(() => {
    if (batchTargetIdx === null) { closeBatchPicker(); return; }
    const picked = batchCandidates[batchSelectedIdx];
    if (!picked) { closeBatchPicker(); return; }
    // A6 · commit: swap batch, re-take MRP from the picked batch (MRP lives
    // on the batch, not the product — per ADR 0010 §2).
    setLines((prev) => prev.map((l, i) =>
      i === batchTargetIdx
        ? { ...l, batch: picked, mrpPaise: picked.mrpPaise as Paise }
        : l,
    ));
    closeBatchPicker();
  }, [batchTargetIdx, batchCandidates, batchSelectedIdx, closeBatchPicker]);

  // Scope-local key handling for the batch picker (↑/↓/Enter/Esc).
  useEffect(() => {
    if (!batchPickerOpen) return undefined;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setBatchSelectedIdx((i) => Math.min(i + 1, Math.max(batchCandidates.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setBatchSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        commitBatchPick();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeBatchPicker();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [batchPickerOpen, batchCandidates.length, commitBatchPick, closeBatchPicker]);

  useEffect(() => {
    if (toast?.kind === "ok") {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [toast]);


  // A12 · Refresh IRN record whenever the saved bill id changes.
  useEffect(() => {
    if (!lastSavedBillId) {
      setIrnRecord(null);
      return;
    }
    let live = true;
    void getIrnForBillRpc(lastSavedBillId).then((rec) => {
      if (live) setIrnRecord(rec);
    }).catch(() => { /* silent — chip just shows "Submit" */ });
    return () => { live = false; };
  }, [lastSavedBillId]);

  const patch = (idx: number, p: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...p } : l)));

  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="bill" data-testid="billing-root" role="region" aria-label="Billing">
      <div className="bill-lines">
        <h2 style={{ marginTop: 0 }}>
          New Bill{" "}
          <span style={{ fontSize: 12, color: "var(--pc-text-tertiary)" }}>
            · <span className="kbd">F1</span> new
            · <span className="kbd">F2</span> customer
            · <span className="kbd">F3</span> add-line
            · <span className="kbd">F4</span> discount
            · <span className="kbd">F6</span> payment
            · <span className="kbd">F7</span> batch
            · <span className="kbd">F10</span> save
            · <span className="kbd">F9</span> print
          </span>
        </h2>

        <div
          role="status"
          aria-live="polite"
          data-testid="toast-live"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
        >
          {toast ? toast.msg : ""}
        </div>

        {toast && (
          <div
            data-testid="toast"
            data-toast-kind={toast.kind}
            role="alert"
            style={{
              padding: "8px 12px",
              marginBottom: 12,
              borderRadius: 4,
              background: toast.kind === "ok" ? "var(--pc-state-success)" : "var(--pc-state-danger)",
              color: "white",
              fontWeight: 600,
            }}
          >
            {toast.msg}
          </div>
        )}

        {lastSavedBillId && (
          <div
            data-testid="irn-chip"
            data-irn-status={irnRecord ? irnRecord.status : "none"}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", marginBottom: 10, borderRadius: 4,
              border: "1px solid #334155", background: "var(--pc-bg-canvas)",
              fontSize: 12, color: "var(--pc-border-default)",
            }}
          >
            <span style={{ fontWeight: 600 }}>e-Invoice IRN</span>
            {(() => {
              if (!irnRecord) {
                return (
                  <>
                    <span style={{ color: "var(--pc-text-tertiary)" }}>not submitted</span>
                    <button
                      data-testid="irn-submit"
                      onClick={() => void submitIrn()}
                      disabled={submittingIrn}
                      style={{
                        marginLeft: "auto",
                        padding: "4px 10px",
                        background: submittingIrn ? "var(--pc-border-default)" : "var(--pc-state-success)",
                        color: "var(--pc-bg-surface)",
                        border: "none",
                        cursor: submittingIrn ? "wait" : "pointer",
                        fontWeight: 600,
                      }}
                    >{submittingIrn ? "Submitting…" : "Submit to IRP"}</button>
                  </>
                );
              }
              const s = irnRecord.status;
              const palette: Record<string, string> = {
                pending: "var(--pc-state-warning)",
                submitted: "var(--pc-state-info)",
                acked: "var(--pc-state-success)",
                failed: "var(--pc-state-danger)",
                cancelled: "var(--pc-text-secondary)",
              };
              return (
                <>
                  <span
                    data-testid="irn-status-badge"
                    style={{
                      background: palette[s] ?? "var(--pc-border-default)",
                      color: "var(--pc-bg-surface)",
                      padding: "2px 8px",
                      borderRadius: 3,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >{s}</span>
                  {irnRecord.irn && (
                    <code
                      data-testid="irn-number"
                      style={{ fontSize: 11, color: "var(--pc-bg-surface-2)" }}
                    >{irnRecord.irn.slice(0, 8)}…{irnRecord.irn.slice(-6)}</code>
                  )}
                  {s === "failed" && irnRecord.errorMsg && (
                    <span
                      data-testid="irn-error"
                      style={{ fontSize: 11, color: "var(--pc-state-danger)" }}
                    >{irnRecord.errorMsg}</span>
                  )}
                  <span style={{ color: "var(--pc-text-secondary)", fontSize: 11 }}>
                    attempt {irnRecord.attemptCount} · {irnRecord.vendor}
                  </span>
                  {(s === "failed" || s === "pending") && (
                    <button
                      data-testid="irn-retry"
                      onClick={() => void retryIrn()}
                      disabled={submittingIrn}
                      style={{
                        marginLeft: "auto",
                        padding: "3px 10px",
                        background: submittingIrn ? "var(--pc-border-default)" : "var(--pc-state-info)",
                        color: "var(--pc-bg-surface)",
                        border: "none",
                        cursor: submittingIrn ? "wait" : "pointer",
                        fontWeight: 600,
                      }}
                    >{submittingIrn ? "Retrying…" : "Retry"}</button>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* A5 — always-visible customer bar. Optional for OTC, required for Schedule H/H1/X. */}
        <div
          data-testid="cust-bar"
          style={{
            border: "1px solid #334155", borderRadius: 4, padding: 10, marginBottom: 12,
            background: "var(--pc-bg-surface-2)",
          }}
        >
          <label
            htmlFor="cust-search"
            style={{ display: "block", fontSize: 11, color: "var(--pc-text-tertiary)", marginBottom: 4 }}
          >
            Customer <span className="kbd">F2</span>
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="cust-search"
              ref={custSearchRef}
              data-testid="cust-search"
              aria-label="Customer search"
              placeholder="Search customer by name / phone / GSTIN (optional for OTC)"
              value={custQuery}
              onChange={(e) => { setCustQuery(e.target.value); if (customer && e.target.value !== customer.name) setCustomer(null); }}
              style={{ width: "100%", padding: "6px 10px" }}
            />
            {custHits.length > 0 && !customer && (
              <ul
                role="listbox"
                aria-label="Customer matches"
                style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                  listStyle: "none", margin: 0, padding: 0,
                  background: "var(--pc-bg-canvas)", border: "1px solid #334155",
                  maxHeight: 180, overflowY: "auto",
                }}
              >
                {custHits.map((c) => (
                  <li
                    key={c.id}
                    role="option"
                    aria-selected="false"
                    data-testid={`cust-hit-${c.id}`}
                    onMouseDown={(e) => { e.preventDefault(); void pickCustomer(c); }}
                    style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #334155" }}
                  >
                    <strong>{c.name}</strong> · {c.phone ?? "—"}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {customer && (
            <div data-testid="cust-selected" style={{ marginTop: 6, fontSize: 13 }}>
              <strong>{customer.name}</strong> · {customer.phone ?? "—"}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }} data-testid="search-wrap">
          <ProductSearch autoFocus onPick={onPick} />
        </div>

        {rxRequired && (
          <div data-testid="rx-required-banner" role="alert" style={{
            border: "1px solid #dc2626", background: "var(--pc-state-danger-bg)", padding: 12, marginBottom: 12, borderRadius: 4,
          }}>
            <div style={{ fontWeight: 600, color: "var(--pc-state-danger)", marginBottom: 6 }}>
              Prescription required (Schedule H/H1/X)
            </div>
            {!customer ? (
              <div style={{ fontSize: 13, color: "var(--pc-state-danger)" }}>
                Pick a customer above (<span className="kbd">F2</span>) to attach prescription.
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 13 }}>
                {rxList.length === 0 ? (
                  <em style={{ color: "var(--pc-text-secondary)" }}>No prescriptions on file.</em>
                ) : (
                  <div data-testid="rx-pick-list">
                    {rxList.map((r) => (
                      <label key={r.id} data-testid={`rx-pick-${r.id}`}
                             style={{ display: "block", padding: "2px 0", fontSize: 13 }}>
                        <input type="radio" name="rx-pick" checked={rxId === r.id}
                               onChange={() => setRxId(r.id)} /> {r.issuedDate} · {r.kind}{r.notes ? ` · ${r.notes}` : ""}
                      </label>
                    ))}
                  </div>
                )}
                <button data-testid="rx-new-toggle" onClick={() => setNewRxOpen((v) => !v)}
                        style={{ marginTop: 6, fontSize: 12 }}>
                  {newRxOpen ? "Cancel" : "+ Add new Rx"}
                </button>
                {newRxOpen && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                    <input data-testid="rx-new-doctor-reg" placeholder="Doctor reg no"
                           value={newDoctorReg} onChange={(e) => setNewDoctorReg(e.target.value)} />
                    <input data-testid="rx-new-doctor-name" placeholder="Doctor name"
                           value={newDoctorName} onChange={(e) => setNewDoctorName(e.target.value)} />
                    <input type="date" data-testid="rx-new-date"
                           value={newRxDate} onChange={(e) => setNewRxDate(e.target.value)} />
                    <input data-testid="rx-new-notes" placeholder="Notes"
                           value={newRxNotes} onChange={(e) => setNewRxNotes(e.target.value)} />
                    <button data-testid="rx-new-save" onClick={() => void saveNewRx()}
                            style={{ gridColumn: "1 / span 2", padding: 6 }}>
                      Save Rx
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {lines.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--pc-text-secondary)" }} data-testid="empty-state">
            No items. Search a product to add a line.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Product</th>
                <th>Batch</th>
                <th>MRP</th>
                <th>Qty</th>
                <th>GST</th>
                <th>Disc %</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const tax = l.productId && l.mrpPaise > 0
                  ? computeLine({ mrpPaise: l.mrpPaise, qty: l.qty, gstRate: l.gstRate, discountPct: l.discountPct }, "intra_state")
                  : null;
                return (
                  <tr key={l.id}>
                    <td>
                      <div><strong>{l.name}</strong></div>
                      {l.schedule !== "OTC" && (
                        <span style={{ background: "var(--pc-state-danger)", color: "white", padding: "1px 5px", borderRadius: 3, fontSize: 10 }}>
                          {l.schedule}
                        </span>
                      )}
                    </td>
                    <td data-testid={`line-batch-${idx}`}>
                      {l.batch
                        ? (() => {
                            const today = new Date().toISOString().slice(0, 10);
                            const days = daysBetweenIso(today, l.batch.expiryDate);
                            const tone =
                              !Number.isFinite(days) || days > EXPIRY_AMBER_DAYS ? "none"
                                : days > EXPIRY_RED_DAYS ? "amber"
                                  : "red";
                            const bg = tone === "red" ? "var(--pc-state-danger)" : tone === "amber" ? "var(--pc-state-warning)" : undefined;
                            return (
                              <>
                                <span title={`Exp ${l.batch.expiryDate}`}>{l.batch.batchNo}</span>
                                {tone !== "none" && (
                                  <span
                                    data-testid={`line-expiry-chip-${idx}`}
                                    data-tone={tone}
                                    style={{
                                      marginLeft: 6, padding: "1px 6px", borderRadius: 3,
                                      fontSize: 10, fontWeight: 700, color: "white",
                                      background: bg,
                                    }}
                                  >
                                    {days}d
                                  </span>
                                )}
                              </>
                            );
                          })()
                        : <span style={{ color: "var(--pc-state-danger)" }}>No stock</span>}
                    </td>
                    <td>{formatINR(l.mrpPaise)}</td>
                    <td>
                      <input
                        type="number" min="0" step="1" value={l.qty}
                        onChange={(e) => patch(idx, { qty: parseFloat(e.target.value) || 0 })}
                        data-testid={`line-qty-${idx}`}
                        aria-label={`Quantity for ${l.name}`}
                        style={{ width: 70 }}
                      />
                    </td>
                    <td>{l.gstRate}%</td>
                    <td>
                      <input
                        ref={(el) => { lineDiscountRefs.current[idx] = el; }}
                        type="number" min="0" max="100" step="0.1" value={l.discountPct}
                        onChange={(e) => patch(idx, { discountPct: parseFloat(e.target.value) || 0 })}
                        data-testid={`line-discount-${idx}`}
                        aria-label={`Discount percent for ${l.name}`}
                        style={{ width: 60 }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }} data-testid={`line-total-${idx}`}>
                      {tax ? formatINR(tax.lineTotalPaise) : "—"}
                    </td>
                    <td>
                      <button
                        onClick={() => removeLine(idx)}
                        data-testid={`line-remove-${idx}`}
                        aria-label={`Remove ${l.name}`}
                        style={{ background: "transparent", color: "var(--pc-text-tertiary)", border: "none", cursor: "pointer" }}
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <aside className="totals" role="complementary" aria-label="Bill totals">
        <h3 style={{ margin: "0 0 12px" }}>Totals</h3>
        <div className="row"><span>Subtotal</span><span data-testid="subtotal">{formatINR(computed.totals.subtotalPaise)}</span></div>
        <div className="row"><span>CGST</span><span>{formatINR(computed.totals.cgstPaise)}</span></div>
        <div className="row"><span>SGST</span><span>{formatINR(computed.totals.sgstPaise)}</span></div>
        <div className="row"><span>IGST</span><span>{formatINR(computed.totals.igstPaise)}</span></div>
        <div className="row"><span>Round-off</span><span>{formatINR(computed.totals.roundOffPaise as Paise)}</span></div>
        <div className="row grand"><span>Grand Total</span><span data-testid="grand-total">{formatINR(computed.totals.grandTotalPaise)}</span></div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void doSave()}
          disabled={!canSave}
          data-testid="save-bill"
          aria-keyshortcuts="F10"
          style={{
            padding: 12,
            background: canSave ? "var(--pc-state-success)" : "var(--pc-text-secondary)",
            color: "white", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 16,
            cursor: canSave ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Saving…" : "Save & Print (F10)"}
        </button>
      </aside>

      {batchPickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-override-title"
          data-testid="batch-override-modal"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110,
          }}
        >
          <div style={{
            background: "var(--pc-bg-surface-2)", color: "var(--pc-text-primary)", padding: 24, borderRadius: 8,
            minWidth: 480, maxWidth: 640, border: "1px solid #334155",
          }}>
            <h3 id="batch-override-title" style={{ margin: "0 0 8px" }}>
              Pick batch (F7)
            </h3>
            {batchCandidates.length <= 1 && (
              <div
                data-testid="batch-override-only-one"
                style={{
                  background: "var(--pc-state-warning)", color: "var(--pc-state-warning-bg)", padding: "6px 10px",
                  borderRadius: 4, fontSize: 12, marginBottom: 8,
                }}
              >
                Only {batchCandidates.length} batch available — press Enter to confirm, Esc to cancel.
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--pc-text-tertiary)", marginBottom: 8 }}>
              ↑/↓ to select · Enter to commit · Esc to cancel
            </div>
            <div
              role="listbox"
              aria-activedescendant={`batch-opt-${batchSelectedIdx}`}
              data-testid="batch-override-listbox"
              style={{
                maxHeight: 260, overflowY: "auto", border: "1px solid #334155",
                borderRadius: 4, marginBottom: 12,
              }}
            >
              {batchCandidates.length === 0 ? (
                <div style={{ padding: 12, color: "var(--pc-state-danger)" }}>
                  No non-expired batches for this product.
                </div>
              ) : (
                batchCandidates.map((c, i) => (
                  <div
                    key={c.id}
                    id={`batch-opt-${i}`}
                    role="option"
                    aria-selected={i === batchSelectedIdx}
                    data-testid={`batch-opt-${i}`}
                    onClick={() => setBatchSelectedIdx(i)}
                    onDoubleClick={() => { setBatchSelectedIdx(i); commitBatchPick(); }}
                    style={{
                      padding: "8px 12px",
                      background: i === batchSelectedIdx ? "var(--pc-state-info)" : "transparent",
                      color: i === batchSelectedIdx ? "white" : "var(--pc-text-primary)",
                      cursor: "pointer",
                      fontFamily: "monospace",
                      fontSize: 13,
                      display: "grid",
                      gridTemplateColumns: "1fr 1.2fr 0.6fr 0.8fr",
                      gap: 8,
                    }}
                  >
                    <span>{c.batchNo}</span>
                    <span>exp {c.expiryDate}</span>
                    <span>qty {c.qtyOnHand}</span>
                    <span>{formatINR((c.mrpPaise) as Paise)}</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={closeBatchPicker}
                data-testid="batch-override-cancel"
                style={{ padding: "8px 14px", background: "var(--pc-border-subtle)", color: "white", border: "none", borderRadius: 4 }}
              >
                Cancel (Esc)
              </button>
              <button
                ref={batchConfirmRef}
                onClick={commitBatchPick}
                data-testid="batch-override-confirm"
                disabled={batchCandidates.length === 0}
                style={{
                  padding: "8px 14px",
                  background: batchCandidates.length ? "var(--pc-state-success)" : "var(--pc-text-secondary)",
                  color: "white", border: "none", borderRadius: 4, fontWeight: 700,
                  cursor: batchCandidates.length ? "pointer" : "not-allowed",
                }}
              >
                Confirm (Enter)
              </button>
            </div>
          </div>
        </div>
      )}

      <PaymentModal
        open={paymentOpen}
        grandTotalPaise={computed.totals.grandTotalPaise}
        onConfirm={(tenders) => void doSave(tenders)}
        onCancel={() => setPaymentOpen(false)}
      />

      <OwnerOverrideModal
        open={overrideOpen}
        target={overrideTarget}
        currentUser={currentUser}
        onOverride={onOverrideDone}
        onCancel={onOverrideCancel}
      />
    </div>
  );
}
