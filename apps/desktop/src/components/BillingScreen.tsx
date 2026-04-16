import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { formatINR, type Paise, type GstRate } from "@pharmacare/shared-types";
import { computeLine, computeInvoice, inferTreatment } from "@pharmacare/gst-engine";
import { ProductSearch } from "./ProductSearch.js";
import {
  pickFefoBatchRpc, saveBillRpc,
  searchCustomersRpc, listPrescriptionsRpc, createPrescriptionRpc, upsertDoctorRpc,
  type ProductHit, type BatchPick, type SaveBillInput,
  type Customer, type Prescription,
} from "../lib/ipc.js";

const RX_REQUIRED = new Set(["H", "H1", "X", "NDPS"]);

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
  const [toast, setToast] = useState<Toast>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

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
  const paymentConfirmRef = useRef<HTMLButtonElement | null>(null);
  const lineDiscountRefs = useRef<Array<HTMLInputElement | null>>([]);

  // ProductSearch encapsulates its own input ref (autoFocus on mount). To
  // re-focus it from outside (F1 reset, F3 add-line), we resolve it by data-testid.
  const focusProductSearch = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="product-search"]');
    el?.focus();
    el?.select();
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
  }, []);

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
  }, []);

  const doSave = useCallback(async () => {
    if (!canSave) return;
    const payload: SaveBillInput = {
      shopId: SHOP.id,
      billNo: genBillNo(),
      cashierId: SHOP.cashierId,
      paymentMode: "cash",
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
    };
    const billId = `bill_${Date.now()}`;
    setSaving(true);
    try {
      const r = await saveBillRpc(billId, payload);
      setToast({ kind: "ok", msg: `Saved · ${payload.billNo} · ${formatINR(r.grandTotalPaise as Paise)}` });
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
      if (e.key === "F10") {
        e.preventDefault();
        if (paymentOpen) { void doSave(); return; }
        void doSave();
        return;
      }
      if (e.key === "Escape") {
        if (paymentOpen) { e.preventDefault(); setPaymentOpen(false); return; }
        if (toast) { setToast(null); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doSave, resetBill, canSave, paymentOpen, toast, lines.length]);

  // Autofocus payment-confirm button when the modal opens so Enter works
  // without any Tab dance.
  useEffect(() => {
    if (paymentOpen) paymentConfirmRef.current?.focus();
  }, [paymentOpen]);

  useEffect(() => {
    if (toast?.kind === "ok") {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [toast]);

  const patch = (idx: number, p: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...p } : l)));

  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="bill" data-testid="billing-root" role="region" aria-label="Billing">
      <div className="bill-lines">
        <h2 style={{ marginTop: 0 }}>
          New Bill{" "}
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            · <span className="kbd">F1</span> new
            · <span className="kbd">F2</span> customer
            · <span className="kbd">F3</span> add-line
            · <span className="kbd">F4</span> discount
            · <span className="kbd">F6</span> payment
            · <span className="kbd">F10</span> save
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
              background: toast.kind === "ok" ? "#16a34a" : "#dc2626",
              color: "white",
              fontWeight: 600,
            }}
          >
            {toast.msg}
          </div>
        )}

        {/* A5 — always-visible customer bar. Optional for OTC, required for Schedule H/H1/X. */}
        <div
          data-testid="cust-bar"
          style={{
            border: "1px solid #334155", borderRadius: 4, padding: 10, marginBottom: 12,
            background: "#1e293b",
          }}
        >
          <label
            htmlFor="cust-search"
            style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}
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
                  background: "#0f172a", border: "1px solid #334155",
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
            border: "1px solid #dc2626", background: "#fef2f2", padding: 12, marginBottom: 12, borderRadius: 4,
          }}>
            <div style={{ fontWeight: 600, color: "#991b1b", marginBottom: 6 }}>
              Prescription required (Schedule H/H1/X)
            </div>
            {!customer ? (
              <div style={{ fontSize: 13, color: "#991b1b" }}>
                Pick a customer above (<span className="kbd">F2</span>) to attach prescription.
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 13 }}>
                {rxList.length === 0 ? (
                  <em style={{ color: "#666" }}>No prescriptions on file.</em>
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
          <div style={{ padding: 24, textAlign: "center", color: "#64748b" }} data-testid="empty-state">
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
                        <span style={{ background: "#dc2626", color: "white", padding: "1px 5px", borderRadius: 3, fontSize: 10 }}>
                          {l.schedule}
                        </span>
                      )}
                    </td>
                    <td data-testid={`line-batch-${idx}`}>
                      {l.batch
                        ? <span title={`Exp ${l.batch.expiryDate}`}>{l.batch.batchNo}</span>
                        : <span style={{ color: "#ef4444" }}>No stock</span>}
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
                        style={{ background: "transparent", color: "#94a3b8", border: "none", cursor: "pointer" }}
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
          onClick={doSave}
          disabled={!canSave}
          data-testid="save-bill"
          aria-keyshortcuts="F10"
          style={{
            padding: 12,
            background: canSave ? "#16a34a" : "#64748b",
            color: "white", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 16,
            cursor: canSave ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Saving…" : "Save & Print (F10)"}
        </button>
      </aside>

      {paymentOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-title"
          data-testid="payment-modal"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
          }}
        >
          <div style={{
            background: "#1e293b", color: "#e5e7eb", padding: 24, borderRadius: 8,
            minWidth: 360, border: "1px solid #334155",
          }}>
            <h3 id="payment-title" style={{ margin: "0 0 12px" }}>Payment</h3>
            <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 16 }}>
              Mode: Cash &middot; Due:{" "}
              <strong data-testid="payment-amount" style={{ color: "#22c55e", fontSize: 18 }}>
                {formatINR(computed.totals.grandTotalPaise)}
              </strong>
              <div style={{ fontSize: 11, marginTop: 4, color: "#64748b" }}>
                Split-tender, card, UPI, change calc arrive in A8.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setPaymentOpen(false)}
                data-testid="payment-cancel"
                style={{ padding: "8px 14px", background: "#334155", color: "white", border: "none", borderRadius: 4 }}
              >
                Cancel (Esc)
              </button>
              <button
                ref={paymentConfirmRef}
                onClick={() => void doSave()}
                data-testid="payment-confirm"
                disabled={!canSave}
                aria-keyshortcuts="F10"
                style={{
                  padding: "8px 14px",
                  background: canSave ? "#16a34a" : "#64748b",
                  color: "white", border: "none", borderRadius: 4, fontWeight: 700,
                  cursor: canSave ? "pointer" : "not-allowed",
                }}
              >
                {saving ? "Saving…" : "Confirm (F10)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
