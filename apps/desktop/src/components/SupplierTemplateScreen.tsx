// SupplierTemplateScreen — X1 Tier A config. Keyboard-first editor for
// supplier invoice parsing templates. Flow: pick supplier -> pick/new template
// -> edit regex/column-map JSON -> paste sample CSV/PDF text -> Test -> Save.
//
// Shortcuts:
//   Ctrl+N  new template
//   Ctrl+S  save current
//   Ctrl+T  test against sample
//   Del     delete selected
//
// All JSON editors are plain <textarea> with client-side JSON.parse validation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type SupplierRow, type SupplierTemplateDTO, type TemplateTestResult,
  type UpsertSupplierTemplateInput,
  listSuppliersRpc, listSupplierTemplatesRpc, upsertSupplierTemplateRpc,
  deleteSupplierTemplateRpc, testSupplierTemplateRpc,
} from "../lib/ipc";

const SHOP_ID = "shop_local";

type DateFmt = SupplierTemplateDTO["dateFormat"];
const DATE_FORMATS: readonly DateFmt[] = ["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD-MMM-YYYY"];

interface DraftTemplate {
  id: string | null;
  supplierId: string;
  name: string;
  headerInvoiceNo: string;
  headerInvoiceDate: string;
  headerTotal: string;
  headerSupplier: string;
  lineRow: string;
  columnMapJson: string;
  dateFormat: DateFmt;
  isActive: boolean;
}

function emptyDraft(supplierId = ""): DraftTemplate {
  return {
    id: null,
    supplierId,
    name: "",
    headerInvoiceNo: "Invoice\\s*(?:No\\.?)?\\s*[:#]?\\s*(\\S+)",
    headerInvoiceDate: "(?:Date|Dated)\\s*[:#]?\\s*(\\d{2}/\\d{2}/\\d{4})",
    headerTotal: "(?:Grand\\s*Total|Total)\\s*[:#]?\\s*(?:Rs\\.?|INR)?\\s*([\\d,]+\\.?\\d*)",
    headerSupplier: "",
    lineRow: "^(\\S+)\\s+(\\S+)\\s+(\\d{2}/\\d{2}/\\d{4})\\s+(\\d+)\\s+([\\d.]+)",
    columnMapJson: JSON.stringify({ product: 0, batchNo: 1, expiryDate: 2, qty: 3, ratePaise: 4 }, null, 2),
    dateFormat: "DD/MM/YYYY",
    isActive: true,
  };
}

function fromDto(t: SupplierTemplateDTO): DraftTemplate {
  return {
    id: t.id,
    supplierId: t.supplierId,
    name: t.name,
    headerInvoiceNo: t.headerPatterns.invoiceNo ?? "",
    headerInvoiceDate: t.headerPatterns.invoiceDate ?? "",
    headerTotal: t.headerPatterns.total ?? "",
    headerSupplier: t.headerPatterns.supplier ?? "",
    lineRow: t.linePatterns.row ?? "",
    columnMapJson: JSON.stringify(t.columnMap, null, 2),
    dateFormat: t.dateFormat,
    isActive: true,
  };
}

export default function SupplierTemplateScreen() {
  const [suppliers, setSuppliers] = useState<readonly SupplierRow[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const [templates, setTemplates] = useState<readonly SupplierTemplateDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTemplate>(emptyDraft());
  const [sampleText, setSampleText] = useState<string>("");
  const [testResult, setTestResult] = useState<TemplateTestResult | null>(null);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const refreshSuppliers = useCallback(async () => {
    try { setSuppliers(await listSuppliersRpc(SHOP_ID)); }
    catch (e) { setError(`load suppliers: ${String(e)}`); }
  }, []);

  const refreshTemplates = useCallback(async (sid: string) => {
    try {
      const sup = sid || undefined;
      const rows = await listSupplierTemplatesRpc(SHOP_ID, sup);
      setTemplates(rows);
    } catch (e) { setError(`load templates: ${String(e)}`); }
  }, []);

  useEffect(() => { void refreshSuppliers(); }, [refreshSuppliers]);
  useEffect(() => { void refreshTemplates(selectedSupplier); }, [selectedSupplier, refreshTemplates]);

  const pickTemplate = useCallback((id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSelectedId(id);
    setDraft(fromDto(t));
    setTestResult(null);
    setError("");
  }, [templates]);

  const newTemplate = useCallback(() => {
    setSelectedId(null);
    setDraft(emptyDraft(selectedSupplier));
    setTestResult(null);
    setError("");
    setTimeout(() => nameRef.current?.focus(), 0);
  }, [selectedSupplier]);

  const buildInput = useCallback((): UpsertSupplierTemplateInput | null => {
    if (!draft.name.trim()) { setError("name required"); return null; }
    if (!draft.supplierId) { setError("supplier required"); return null; }
    let columnMap: Record<string, number | string>;
    try { columnMap = JSON.parse(draft.columnMapJson); }
    catch (e) { setError(`column map JSON: ${String(e)}`); return null; }
    const headerPatterns: UpsertSupplierTemplateInput["headerPatterns"] = {
      invoiceNo: draft.headerInvoiceNo,
      invoiceDate: draft.headerInvoiceDate,
      total: draft.headerTotal,
      ...(draft.headerSupplier.trim() ? { supplier: draft.headerSupplier } : {}),
    };
    const base: UpsertSupplierTemplateInput = {
      shopId: SHOP_ID,
      supplierId: draft.supplierId,
      name: draft.name.trim(),
      headerPatterns,
      linePatterns: { row: draft.lineRow },
      columnMap,
      dateFormat: draft.dateFormat,
      isActive: draft.isActive,
    };
    return draft.id ? { ...base, id: draft.id } : base;
  }, [draft]);

  const doSave = useCallback(async () => {
    setError("");
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      const id = await upsertSupplierTemplateRpc(input);
      setSelectedId(id);
      setDraft((d) => ({ ...d, id }));
      await refreshTemplates(selectedSupplier);
    } catch (e) { setError(`save: ${String(e)}`); }
    finally { setSaving(false); }
  }, [buildInput, refreshTemplates, selectedSupplier]);

  const doDelete = useCallback(async () => {
    if (!selectedId) return;
    if (!confirm("Delete this template?")) return;
    try {
      await deleteSupplierTemplateRpc(selectedId);
      setSelectedId(null);
      setDraft(emptyDraft(selectedSupplier));
      await refreshTemplates(selectedSupplier);
    } catch (e) { setError(`delete: ${String(e)}`); }
  }, [selectedId, selectedSupplier, refreshTemplates]);

  const doTest = useCallback(async () => {
    setError("");
    const input = buildInput();
    if (!input) return;
    const dto: SupplierTemplateDTO = {
      id: draft.id ?? "draft",
      supplierId: input.supplierId,
      name: input.name,
      headerPatterns: input.headerPatterns,
      linePatterns: input.linePatterns,
      columnMap: input.columnMap,
      dateFormat: draft.dateFormat,
    };
    try {
      const r = await testSupplierTemplateRpc(dto, sampleText);
      setTestResult(r);
    } catch (e) { setError(`test: ${String(e)}`); }
  }, [buildInput, draft, sampleText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); newTemplate(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "t") { e.preventDefault(); void doTest(); }
      else if (e.key === "Delete" && selectedId) { e.preventDefault(); void doDelete(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newTemplate, doSave, doTest, doDelete, selectedId]);

  const supplierOptions = useMemo(() => suppliers.map((s) => (
    <option key={s.id} value={s.id}>{s.name}</option>
  )), [suppliers]);

  return (
    <div className="mx-auto max-w-[1280px] p-4 lg:p-6 text-[var(--pc-text-primary)]">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight">Supplier templates</h1>
        <p className="text-[12px] text-[var(--pc-text-secondary)]">parse rules for distributor invoices</p>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 1fr", gap: 12, height: "calc(100vh - 200px)" }}>
      <div data-testid="tpl-sidebar" className="overflow-auto rounded-[var(--pc-radius-lg)] border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] p-3">
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Supplier</label>
          <select
            data-testid="tpl-supplier-filter"
            value={selectedSupplier}
            onChange={(e) => setSelectedSupplier(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">All suppliers</option>
            {supplierOptions}
          </select>
        </div>
        <button data-testid="tpl-new" onClick={newTemplate} style={{ width: "100%", marginBottom: 8 }}>
          + New template (Ctrl+N)
        </button>
        <div style={{ fontSize: 12, color: "var(--pc-text-secondary)", marginBottom: 4 }}>Templates ({templates.length})</div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {templates.map((t) => (
            <li key={t.id}>
              <button
                data-testid={`tpl-row-${t.id}`}
                onClick={() => pickTemplate(t.id)}
                style={{
                  width: "100%", textAlign: "left", padding: "6px 8px",
                  background: t.id === selectedId ? "var(--pc-state-info-bg)" : "transparent",
                  border: "1px solid #eee", marginBottom: 2, cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: "var(--pc-text-tertiary)" }}>{t.supplierId}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div data-testid="tpl-editor" style={{ overflow: "auto" }}>
        <h3 style={{ margin: "0 0 8px" }}>{draft.id ? "Edit template" : "New template"}</h3>
        {error && <div data-testid="tpl-error" style={{ color: "var(--pc-state-danger)", marginBottom: 8 }}>{error}</div>}

        <label style={{ display: "block", fontSize: 12 }}>Name</label>
        <input
          data-testid="tpl-name"
          ref={nameRef}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          style={{ width: "100%", marginBottom: 8 }}
        />

        <label style={{ display: "block", fontSize: 12 }}>Supplier</label>
        <select
          data-testid="tpl-supplier"
          value={draft.supplierId}
          onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}
          style={{ width: "100%", marginBottom: 8 }}
        >
          <option value="">— select —</option>
          {supplierOptions}
        </select>

        <label style={{ display: "block", fontSize: 12 }}>Date format</label>
        <select
          data-testid="tpl-dateformat"
          value={draft.dateFormat}
          onChange={(e) => setDraft({ ...draft, dateFormat: e.target.value as DateFmt })}
          style={{ width: "100%", marginBottom: 8 }}
        >
          {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>

        <fieldset style={{ marginBottom: 8 }}>
          <legend style={{ fontSize: 12 }}>Header patterns (regex)</legend>
          <label style={{ fontSize: 11 }}>invoiceNo</label>
          <input data-testid="tpl-hdr-invno" value={draft.headerInvoiceNo}
            onChange={(e) => setDraft({ ...draft, headerInvoiceNo: e.target.value })}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} />
          <label style={{ fontSize: 11 }}>invoiceDate</label>
          <input data-testid="tpl-hdr-invdate" value={draft.headerInvoiceDate}
            onChange={(e) => setDraft({ ...draft, headerInvoiceDate: e.target.value })}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} />
          <label style={{ fontSize: 11 }}>total</label>
          <input data-testid="tpl-hdr-total" value={draft.headerTotal}
            onChange={(e) => setDraft({ ...draft, headerTotal: e.target.value })}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} />
          <label style={{ fontSize: 11 }}>supplier (optional)</label>
          <input data-testid="tpl-hdr-supplier" value={draft.headerSupplier}
            onChange={(e) => setDraft({ ...draft, headerSupplier: e.target.value })}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} />
        </fieldset>

        <label style={{ display: "block", fontSize: 12 }}>Line row regex</label>
        <textarea
          data-testid="tpl-line-row"
          value={draft.lineRow}
          onChange={(e) => setDraft({ ...draft, lineRow: e.target.value })}
          rows={3}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12, marginBottom: 8 }}
        />

        <label style={{ display: "block", fontSize: 12 }}>Column map (JSON)</label>
        <textarea
          data-testid="tpl-colmap"
          value={draft.columnMapJson}
          onChange={(e) => setDraft({ ...draft, columnMapJson: e.target.value })}
          rows={8}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12, marginBottom: 8 }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button data-testid="tpl-save" onClick={doSave} disabled={saving}>
            {saving ? "Saving…" : "Save (Ctrl+S)"}
          </button>
          <button data-testid="tpl-test" onClick={doTest}>Test (Ctrl+T)</button>
          <button data-testid="tpl-delete" onClick={doDelete} disabled={!selectedId} style={{ color: "var(--pc-state-danger)" }}>
            Delete (Del)
          </button>
        </div>
      </div>

      <div data-testid="tpl-test-pane" style={{ overflow: "auto", borderLeft: "1px solid #ccc", paddingLeft: 8 }}>
        <label style={{ display: "block", fontSize: 12 }}>Sample text (paste invoice text / CSV)</label>
        <textarea
          data-testid="tpl-sample"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          rows={14}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12, marginBottom: 8 }}
        />
        {testResult && (
          <div data-testid="tpl-result">
            <h4 style={{ margin: "4px 0" }}>Header (confidence {testResult.header.confidence.toFixed(2)})</h4>
            <table style={{ width: "100%", fontSize: 12 }}>
              <tbody>
                <tr><td>invoiceNo</td><td data-testid="tpl-result-invno">{testResult.header.invoiceNo ?? "—"}</td></tr>
                <tr><td>invoiceDate</td><td data-testid="tpl-result-invdate">{testResult.header.invoiceDate ?? "—"}</td></tr>
                <tr><td>totalPaise</td><td>{testResult.header.totalPaise ?? "—"}</td></tr>
                <tr><td>supplierHint</td><td>{testResult.header.supplierHint ?? "—"}</td></tr>
              </tbody>
            </table>
            <h4 style={{ margin: "8px 0 4px" }}>Lines ({testResult.lines.length})</h4>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead><tr><th align="left">product</th><th>batch</th><th>expiry</th><th>qty</th><th>rate</th><th>mrp</th><th>gst</th><th>conf</th></tr></thead>
              <tbody>
                {testResult.lines.map((l, i) => (
                  <tr key={i} data-testid={`tpl-result-line-${i}`}>
                    <td>{l.productHint}</td>
                    <td>{l.batchNo ?? "—"}</td>
                    <td>{l.expiryDate ?? "—"}</td>
                    <td>{l.qty}</td>
                    <td>{l.ratePaise}</td>
                    <td>{l.mrpPaise ?? "—"}</td>
                    <td>{l.gstRate ?? "—"}</td>
                    <td>{l.confidence.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
