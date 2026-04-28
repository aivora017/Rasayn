import { useCallback, useEffect, useRef, useState } from "react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
import {
  matchParsedLine,
  confidenceTier,
  type CandidateProduct,
  type LineMatch,
} from "@pharmacare/gmail-grn-bridge";
import { ProductSearch } from "./ProductSearch.js";
import {
  listSuppliersRpc,
  saveGrnRpc,
  searchProductsRpc,
  type ProductHit,
  type SaveGrnInput,
  type SupplierRow,
} from "../lib/ipc.js";
import {
  peekPendingGrnDraft,
  dismissPendingGrnDraft,
  type PendingGrnDraft,
} from "../lib/pendingGrnDraft.js";
import { PhotoBillCapture } from "./PhotoBillCapture.js";

// D03 (tech-debt 2026-04-18): the hard-coded SUPPLIERS demo list was removed.
// Real supplier rows now come from `listSuppliersRpc(shopId)` on mount.
// Pilot single-shop id is "shop_local" (matches ensure_default_shop seed).
const SHOP_ID = "shop_local";

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

// Per-imported-line resolution state: `null` = resolving (async search in
// flight); `LineMatch` = bridge verdict.
type ImportedLineState =
  | { readonly kind: "pending" }
  | { readonly kind: "resolved"; readonly match: LineMatch }
  | { readonly kind: "skipped" };

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

function productHitToCandidate(h: ProductHit): CandidateProduct {
  return { id: h.id, name: h.name, hsn: h.hsn ?? null, mrpPaise: h.mrpPaise };
}

export function GrnScreen() {
  const [suppliers, setSuppliers] = useState<readonly SupplierRow[]>([]);
  const [supplierId, setSupplierId] = useState<string>("");
  const [invoiceNo, setInvoiceNo] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [saving, setSaving] = useState(false);
  const [importedDraft, setImportedDraft] = useState<PendingGrnDraft | null>(null);
  const [importedLineStates, setImportedLineStates] = useState<readonly ImportedLineState[]>([]);
  // Externally-driven pre-type signal for ProductSearch. Set by the
  // "Search manually" button on low-confidence / unmatched import rows so
  // the owner sees immediate candidates without re-typing the hint.
  const [productSearchInitialQuery, setProductSearchInitialQuery] = useState<string>("");
  // S05 — guard against React.StrictMode double-invoke of the import effect.
  // Combined with the non-destructive peek in pendingGrnDraft.ts, this keeps
  // the draft visible across both mounts but only triggers auto-match once.
  const importAttemptedRef = useRef<boolean>(false);

  // D03 — load suppliers once on mount. Empty/failed load still renders the
  // screen; Save gate below requires supplierId non-empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listSuppliersRpc(SHOP_ID);
        if (cancelled) return;
        setSuppliers(rows);
        if (rows.length > 0 && !supplierId) setSupplierId(rows[0]!.id);
      } catch {
        if (!cancelled) setSuppliers([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up any Gmail-inbox handoff on mount (F7 → "Send to GRN") and kick
  // off auto-match for each parsed line. High/medium confidence matches
  // auto-append DraftLines; low / unmatched stay visible in the banner with
  // Skip + Search-manually actions.
  useEffect(() => {
    if (importAttemptedRef.current) return;
    const d = peekPendingGrnDraft();
    if (!d) return;
    importAttemptedRef.current = true;
    setImportedDraft(d);
    if (d.invoiceNo) setInvoiceNo(d.invoiceNo);
    if (d.invoiceDate) setInvoiceDate(d.invoiceDate);
    const initial: ImportedLineState[] = d.parsedLines.map(() => ({ kind: "pending" }));
    setImportedLineStates(initial);

    let cancelled = false;
    (async () => {
      for (let i = 0; i < d.parsedLines.length; i += 1) {
        const pl = d.parsedLines[i]!;
        let match: LineMatch;
        // Capture hits here so the auto-append branch can reuse them instead
        // of issuing a second searchProductsRpc (S05b — dedupe).
        let hits: readonly ProductHit[] = [];
        try {
          hits = await searchProductsRpc(pl.productHint, 5);
          const cands = hits.map(productHitToCandidate);
          match = matchParsedLine(pl.productHint, pl.hsn ?? null, cands);
        } catch {
          match = { kind: "unmatched", product: null, matchType: "none", confidence: 0, reason: "search failed" };
        }
        if (cancelled) return;
        setImportedLineStates((prev) => {
          const next = prev.slice();
          next[i] = { kind: "resolved", match };
          return next;
        });
        // Auto-append high/medium matches. Low/unmatched stay visible and
        // require a manual action.
        if (match.kind === "matched" && confidenceTier(match.confidence) !== "low") {
          const hit = hits.find((h) => h.id === match.product!.id);
          if (!hit) continue;
          setLines((ls) => [
            ...ls,
            {
              key: `${hit.id}-${Date.now()}-${ls.length}`,
              productId: hit.id,
              name: hit.name,
              batchNo: pl.batchNo ?? "",
              mfgDate: "",
              expiryDate: pl.expiryDate ?? "",
              qty: pl.qty > 0 ? pl.qty : 1,
              purchasePricePaise: pl.ratePaise as Paise,
              mrpPaise: (pl.mrpPaise ?? hit.mrpPaise) as Paise,
            },
          ]);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const skipImportedLine = useCallback((idx: number) => {
    setImportedLineStates((prev) => {
      const next = prev.slice();
      next[idx] = { kind: "skipped" };
      return next;
    });
  }, []);

  // Pre-fill the ProductSearch input with the parsed hint and scroll it into
  // view. The scroll is a nice-to-have UX affordance — jsdom doesn't
  // implement it, so tests won't assert on it.
  const searchManually = useCallback((hint: string) => {
    setProductSearchInitialQuery(hint);
    if (typeof document !== "undefined") {
      const el = document.querySelector('[data-testid="grn-product-search"]') as HTMLElement | null;
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      el?.focus?.();
    }
  }, []);

  const totalCost = lines.reduce((s, l) => s + l.purchasePricePaise * l.qty, 0);

  const canSave =
    !saving &&
    supplierId.length > 0 &&
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
      // S05 — release the imported draft (if any) on successful save so a
      // future GrnScreen remount won't re-import the same invoice.
      dismissPendingGrnDraft();
      setImportedDraft(null);
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
    <div className="mx-auto max-w-[1280px] p-4 lg:p-6 text-[var(--pc-text-primary)]">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight">Receive (GRN)</h1>
        <p className="text-[12px] text-[var(--pc-text-secondary)]">manual entry · Gmail import (X1) · photo-bill (X3)</p>
        <div className="ml-auto inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-[var(--pc-radius-pill)] px-2 py-0.5 text-[11px] font-medium bg-[var(--pc-accent-saffron-soft)] text-[var(--pc-accent-saffron-hover)]">X3</span>
          <span className="text-[10px] text-[var(--pc-text-secondary)]">Drag a paper bill anywhere to capture</span>
        </div>
      </header>
      {!importedDraft && (
        <div className="mb-4">
          <PhotoBillCapture />
        </div>
      )}
      {importedDraft && (
        <div
          data-testid="grn-imported-banner"
          style={{
            background: "var(--pc-state-info-bg)", border: "1px solid #9ec5ff", padding: 8,
            marginBottom: 12, fontSize: 12, borderRadius: 4,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>Imported from Gmail</strong>
              {importedDraft.supplierHint && <> · supplier hint: <em>{importedDraft.supplierHint}</em></>}
              {importedDraft.sourceMessageId && <> · msg <code>{importedDraft.sourceMessageId}</code></>}
            </div>
            <button
              data-testid="grn-imported-dismiss"
              onClick={() => {
                // S05 — release the keyed store too, not just local state.
                dismissPendingGrnDraft();
                setImportedDraft(null);
              }}
            >Dismiss</button>
          </div>
          {importedDraft.parsedLines.length > 0 && (
            <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: "var(--pc-state-info-bg)" }}>
                <th style={{ textAlign: "left", padding: 4 }}>Parsed product</th>
                <th style={{ textAlign: "left", padding: 4 }}>Match</th>
                <th style={{ textAlign: "left", padding: 4 }}>Batch</th>
                <th style={{ textAlign: "left", padding: 4 }}>Expiry</th>
                <th style={{ textAlign: "right", padding: 4 }}>Qty</th>
                <th style={{ textAlign: "right", padding: 4 }}>Rate</th>
                <th />
              </tr></thead>
              <tbody>
                {importedDraft.parsedLines.map((l, i) => {
                  const state = importedLineStates[i] ?? { kind: "pending" };
                  let badge: string;
                  let badgeTestId: string;
                  let actionCell: React.ReactNode = null;
                  if (state.kind === "pending") {
                    badge = "…";
                    badgeTestId = "grn-imp-match-pending";
                  } else if (state.kind === "skipped") {
                    badge = "skipped";
                    badgeTestId = "grn-imp-match-skipped";
                  } else {
                    const m = state.match;
                    if (m.kind === "matched") {
                      const tier = confidenceTier(m.confidence);
                      badge = `${tier} · ${m.product!.name}`;
                      badgeTestId = `grn-imp-match-${tier}`;
                      if (tier === "low") {
                        actionCell = (
                          <>
                            <button
                              data-testid={`grn-imp-skip-${i}`}
                              onClick={() => skipImportedLine(i)}
                              style={{ marginRight: 4 }}
                            >Skip</button>
                            <button
                              data-testid={`grn-imp-search-${i}`}
                              onClick={() => searchManually(l.productHint)}
                            >Search manually</button>
                          </>
                        );
                      }
                    } else {
                      badge = "no match";
                      badgeTestId = "grn-imp-match-unmatched";
                      actionCell = (
                        <>
                          <button
                            data-testid={`grn-imp-skip-${i}`}
                            onClick={() => skipImportedLine(i)}
                            style={{ marginRight: 4 }}
                          >Skip</button>
                          <button
                            data-testid={`grn-imp-search-${i}`}
                            onClick={() => searchManually(l.productHint)}
                          >Search manually</button>
                        </>
                      );
                    }
                  }
                  return (
                    <tr key={i} data-testid={`grn-imported-line-${i}`} data-match-state={state.kind}>
                      <td style={{ padding: 4 }}>{l.productHint}</td>
                      <td style={{ padding: 4 }} data-testid={badgeTestId}>{badge}</td>
                      <td style={{ padding: 4 }}>{l.batchNo ?? "—"}</td>
                      <td style={{ padding: 4 }}>{l.expiryDate ?? "—"}</td>
                      <td style={{ padding: 4, textAlign: "right" }}>{l.qty}</td>
                      <td style={{ padding: 4, textAlign: "right" }}>{(l.ratePaise / 100).toFixed(2)}</td>
                      <td style={{ padding: 4 }}>{actionCell}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 6, color: "var(--pc-text-secondary)" }}>
            High/medium-confidence matches are auto-appended below. Low / no-match rows stay here — skip or search manually, then save with F9.
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
            disabled={suppliers.length === 0}
          >
            {suppliers.length === 0 && (
              <option value="">(No suppliers — add in Settings)</option>
            )}
            {suppliers.map((s) => (
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
        <ProductSearch onPick={addFromPick} testId="grn-product-search" initialQuery={productSearchInitialQuery} />
      </div>

      {lines.length === 0 ? (
        <div data-testid="grn-empty" style={{ padding: 24, color: "var(--pc-text-tertiary)", textAlign: "center" }}>
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
            background: toast.kind === "ok" ? "var(--pc-state-success)" : "var(--pc-state-danger)",
            color: "var(--pc-bg-surface)", fontWeight: 500,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
