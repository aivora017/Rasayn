import { useCallback, useEffect, useState } from "react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
import { ProductSearch } from "./ProductSearch.js";
import { saveGrnRpc, type ProductHit, type SaveGrnInput } from "../lib/ipc.js";
import { takePendingGrnDraft, type PendingGrnDraft } from "../lib/pendingGrnDraft.js";

// Demo supplier list — will come from a suppliers IPC in a later step.
const SUPPLIERS: readonly { id: string; name: string }[] = [
  { id: "sup_gsk", name: "GlaxoSmithKline Pharma" },
  { id: "sup_cipla", name: "Cipla Ltd." },
  { id: "sup_sun", name: "Sun Pharmaceutical" },
  { id: "sup_alembic", name: "Alembic Pharmaceuticals" },
  { id: "sup_localwhl", name: "Kalyan Medical Distributors" },
];

interface DraftLine {
  readonly key: string;
  readonly productId: string;
  readonly name: string;
  readonly batchNo: string;
  readonly mfgDate: string;
  readonly expiryDate: string;
  readonly qty: number;
  readonly purchasePricePaise: Paise;
  readonly mrpPaise: Paise;
}

type Toast = { kind: "ok" | "err"; msg: string } | null;

function genGrnId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  return `grn_${stamp}`;
}

function rsToPaise(rs: string): Paise {
  const n = Number(rs);
  if (!Number.isFinite(n) || n < 0) return 0 as Paise;
  return Math.round(n * 100) as Paise;
}

export function GrnScreen() {
  const [supplierId, setSupplierId] = useState<string>(SUPPLIERS[0]!.id);
  const [invoiceNo, setInvoiceNo] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [saving, setSaving] = useState(false);
  const [importedDraft, setImportedDraft] = useState<PendingGrnDraft | null>(null);

  // Pick up any Gmail-inbox handoff on mount (F7 → "Send to GRN").
  useEffect(() => {
    const d = takePendingGrnDraft();
    if (!d) return;
    setImportedDraft(d);
    if (d.invoiceNo) setInvoiceNo(d.invoiceNo);
    if (d.invoiceDate) setInvoiceDate(d.invoiceDate);
  }, []);

  useEffect(() => {
    if (!toast || toast.kind !== "ok") return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const addFromPick = useCallback((h: ProductHit) => {
    setLines((ls) => [
      ...ls,
      {
        key: `${h.id}-${Date.now()}-${ls.length}`,
        productId: h.id,
        name: h.name,
        batchNo: "",
        mfgDate: "",
        expiryDate: "",
        qty: 1,
        purchasePricePaise: Math.round(h.mrpPaise * 0.7) as Paise,
        mrpPaise: h.mrpPaise as Paise,
      },
    ]);
  }, []);

  const updateLine = useCallback((idx: number, patch: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }, []);

  const removeLine = useCallback((idx: number) => {
    setLines((ls) => ls.filter((_, i) => i !== idx));
  }, []);

  const totalCost = lines.reduce((s, l) => s + l.purchasePricePaise * l.qty, 0);

  const canSave =
    !saving &&
    invoiceNo.trim().length > 0 &&
    lines.length > 0 &&
    lines.every((l) =>
      l.batchNo.trim().length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(l.mfgDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(l.expiryDate) &&
      l.expiryDate >= l.mfgDate &&
      l.qty > 0 &&
      l.mrpPaise > 0,
    );

  const doSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const input: SaveGrnInput = {
        supplierId,
        invoiceNo: invoiceNo.trim(),
        invoiceDate,
        lines: lines.map((l) => ({
          productId: l.productId,
          batchNo: l.batchNo.trim(),
          mfgDate: l.mfgDate,
          expiryDate: l.expiryDate,
          qty: l.qty,
          purchasePricePaise: l.purchasePricePaise,
          mrpPaise: l.mrpPaise,
        })),
      };
      const res = await saveGrnRpc(genGrnId(), input);
      setToast({ kind: "ok", msg: `Saved GRN · ${res.linesInserted} batch${res.linesInserted === 1 ? "" : "es"}` });
      setLines([]);
      setInvoiceNo("");
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }, [canSave, supplierId, invoiceNo, invoiceDate, lines]);

  // F9 shortcut: save GRN.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F9") { e.preventDefault(); void doSave(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doSave]);

  return (
    <div style={{ padding: 16 }}>
      {importedDraft && (
        <div
          data-testid="grn-imported-banner"
          style={{
            background: "#eef6ff", border: "1px solid #9ec5ff", padding: 8,
            marginBottom: 12, fontSize: 12, borderRadius: 4,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>Imported from Gmail</strong>
              {importedDraft.supplierHint && <> · supplier hint: <em>{importedDraft.supplierHint}</em></>}
              {importedDraft.sourceMessageId && <> · msg <code>{importedDraft.sourceMessageId}</code></>}
            </div>
            <button data-testid="grn-imported-dismiss" onClick={() => setImportedDraft(null)}>Dismiss</button>
          </div>
          {importedDraft.parsedLines.length > 0 && (
            <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: "#dbeafe" }}>
                <th style={{ textAlign: "left", padding: 4 }}>Parsed product</th>
                <th style={{ textAlign: "left", padding: 4 }}>Batch</th>
                <th style={{ textAlign: "left", padding: 4 }}>Expiry</th>
                <th style={{ textAlign: "right", padding: 4 }}>Qty</th>
                <th style={{ textAlign: "right", padding: 4 }}>Rate</th>
              </tr></thead>
              <tbody>
                {importedDraft.parsedLines.map((l, i) => (
                  <tr key={i} data-testid={`grn-imported-line-${i}`}>
                    <td style={{ padding: 4 }}>{l.productHint}</td>
                    <td style={{ padding: 4 }}>{l.batchNo ?? "—"}</td>
                    <td style={{ padding: 4 }}>{l.expiryDate ?? "—"}</td>
                    <td style={{ padding: 4, textAlign: "right" }}>{l.qty}</td>
                    <td style={{ padding: 4, textAlign: "right" }}>{(l.ratePaise / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 6, color: "#555" }}>
            Match each parsed line to a product using the search below, then save with F9.
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          Supplier
          <select
            data-testid="grn-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            style={{ padding: "6px 8px", minWidth: 240 }}
          >
            {SUPPLIERS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          Invoice #
          <input
            data-testid="grn-invoice-no"
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            style={{ padding: "6px 8px", minWidth: 200 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          Invoice date
          <input
            type="date"
            data-testid="grn-invoice-date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            style={{ padding: "6px 8px" }}
          />
        </label>
        <div style={{ flex: 1 }} />
        <button
          data-testid="save-grn"
          disabled={!canSave}
          onClick={() => void doSave()}
          style={{ padding: "8px 16px", fontWeight: 600 }}
        >
          {saving ? "Saving…" : "Save GRN (F9)"}
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <ProductSearch onPick={addFromPick} testId="grn-product-search" />
      </div>

      {lines.length === 0 ? (
        <div data-testid="grn-empty" style={{ padding: 24, color: "#888", textAlign: "center" }}>
          Search a product above to start a receipt.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
              <th style={{ padding: 6 }}>Product</th>
              <th style={{ padding: 6 }}>Batch #</th>
              <th style={{ padding: 6 }}>Mfg</th>
              <th style={{ padding: 6 }}>Expiry</th>
              <th style={{ padding: 6 }}>Qty</th>
              <th style={{ padding: 6 }}>Cost ₹</th>
              <th style={{ padding: 6 }}>MRP ₹</th>
              <th style={{ padding: 6 }}>Line total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} data-testid={`grn-row-${i}`} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 6 }}>{l.name}</td>
                <td style={{ padding: 6 }}>
                  <input
                    data-testid={`grn-batch-${i}`}
                    value={l.batchNo}
                    onChange={(e) => updateLine(i, { batchNo: e.target.value })}
                    style={{ width: 120 }}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input
                    type="date"
                    data-testid={`grn-mfg-${i}`}
                    value={l.mfgDate}
                    onChange={(e) => updateLine(i, { mfgDate: e.target.value })}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input
                    type="date"
                    data-testid={`grn-expiry-${i}`}
                    value={l.expiryDate}
                    onChange={(e) => updateLine(i, { expiryDate: e.target.value })}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input
                    type="number"
                    min={1}
                    data-testid={`grn-qty-${i}`}
                    value={l.qty}
                    onChange={(e) => updateLine(i, { qty: Math.max(1, Number(e.target.value) || 0) })}
                    style={{ width: 60 }}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    data-testid={`grn-cost-${i}`}
                    value={(l.purchasePricePaise / 100).toFixed(2)}
                    onChange={(e) => updateLine(i, { purchasePricePaise: rsToPaise(e.target.value) })}
                    style={{ width: 80 }}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    data-testid={`grn-mrp-${i}`}
                    value={(l.mrpPaise / 100).toFixed(2)}
                    onChange={(e) => updateLine(i, { mrpPaise: rsToPaise(e.target.value) })}
                    style={{ width: 80 }}
                  />
                </td>
                <td style={{ padding: 6 }} data-testid={`grn-line-total-${i}`}>
                  {formatINR((l.purchasePricePaise * l.qty) as Paise)}
                </td>
                <td style={{ padding: 6 }}>
                  <button data-testid={`grn-remove-${i}`} onClick={() => removeLine(i)} aria-label="remove">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} style={{ padding: 6, textAlign: "right", fontWeight: 600 }}>Total cost</td>
              <td style={{ padding: 6, fontWeight: 600 }} data-testid="grn-total-cost">{formatINR(totalCost as Paise)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      {toast && (
        <div
          data-testid="grn-toast"
          data-toast-kind={toast.kind}
          style={{
            position: "fixed", bottom: 40, right: 24,
            padding: "10px 16px", borderRadius: 6,
            background: toast.kind === "ok" ? "#1e7d32" : "#b00020",
            color: "#fff", fontWeight: 500,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
