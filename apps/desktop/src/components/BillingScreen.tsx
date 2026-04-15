import { useMemo, useState, useCallback, useEffect } from "react";
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

  const rxRequired = useMemo(() => lines.some((l) => RX_REQUIRED.has(l.schedule)), [lines]);

  useEffect(() => {
    if (!rxRequired) { setCustomer(null); setRxId(null); setRxList([]); setNewRxOpen(false); }
  }, [rxRequired]);

  useEffect(() => {
    if (!rxRequired) return;
    const t = setTimeout(async () => {
      if (!custQuery.trim()) { setCustHits([]); return; }
      setCustHits(await searchCustomersRpc(SHOP.id, custQuery, 8));
    }, 120);
    return () => clearTimeout(t);
  }, [custQuery, rxRequired]);

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "err", msg: `Save failed: ${msg}` });
    } finally {
      setSaving(false);
    }
  }, [canSave, lines, customer, rxId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F9") { e.preventDefault(); void doSave(); }
      if (e.key === "Escape" && toast) { setToast(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doSave, toast]);

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
    <div className="bill">
      <div className="bill-lines">
        <h2 style={{ marginTop: 0 }}>
          New Bill <span style={{ fontSize: 12, color: "#94a3b8" }}>· Type to search · <span className="kbd">↵</span> add · <span className="kbd">F9</span> save</span>
        </h2>

        {toast && (
          <div
            data-testid="toast"
            data-toast-kind={toast.kind}
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

        <div style={{ marginBottom: 16 }} data-testid="search-wrap">
          <ProductSearch autoFocus onPick={onPick} />
        </div>

        {rxRequired && (
          <div data-testid="rx-required-banner" style={{
            border: "1px solid #dc2626", background: "#fef2f2", padding: 12, marginBottom: 12, borderRadius: 4,
          }}>
            <div style={{ fontWeight: 600, color: "#991b1b", marginBottom: 6 }}>
              Prescription required (Schedule H/H1/X)
            </div>
            <div style={{ position: "relative" }}>
              <input
                data-testid="rx-cust-search"
                placeholder="Search customer by name / phone"
                value={custQuery}
                onChange={(e) => { setCustQuery(e.target.value); if (customer && e.target.value !== customer.name) setCustomer(null); }}
                style={{ width: "100%", padding: "6px 10px" }}
              />
              {custHits.length > 0 && !customer && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ccc", zIndex: 10, maxHeight: 180, overflowY: "auto" }}>
                  {custHits.map((c) => (
                    <div key={c.id} data-testid={`rx-cust-hit-${c.id}`} onClick={() => void pickCustomer(c)}
                         style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #eee" }}>
                      <strong>{c.name}</strong> · {c.phone ?? "—"}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {customer && (
              <div data-testid="rx-cust-selected" style={{ marginTop: 8, fontSize: 13 }}>
                <strong>{customer.name}</strong> · {customer.phone ?? "—"}
                <div style={{ marginTop: 6 }}>
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
                        style={{ width: 70 }}
                      />
                    </td>
                    <td>{l.gstRate}%</td>
                    <td>
                      <input
                        type="number" min="0" max="100" step="0.1" value={l.discountPct}
                        onChange={(e) => patch(idx, { discountPct: parseFloat(e.target.value) || 0 })}
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

      <aside className="totals">
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
          style={{
            padding: 12,
            background: canSave ? "#16a34a" : "#64748b",
            color: "white", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 16,
            cursor: canSave ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Saving…" : "Save & Print (F9)"}
        </button>
      </aside>
    </div>
  );
}
