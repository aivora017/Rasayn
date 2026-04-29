// StockTransferScreen — S15.3 real impl.
// List, create, dispatch, receive, cancel inter-store transfers.
// Backed by 6 Tauri commands + migration 0040.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Truck, ArrowRight, CheckCircle2, AlertTriangle, X, Plus } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  stockTransferListRpc,
  stockTransferCreateRpc,
  stockTransferDispatchRpc,
  stockTransferReceiveRpc,
  stockTransferCancelRpc,
  stockTransferListLinesRpc,
  type StockTransferDTO,
  type StockTransferLineDTO,
} from "../lib/ipc.js";

const SHOP_ID = "shop_local";

type Toast = { kind: "ok" | "err"; msg: string } | null;

export default function StockTransferScreen(): React.ReactElement {
  const [transfers, setTransfers] = useState<readonly StockTransferDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [toShopId, setToShopId] = useState("");
  const [productId, setProductId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");

  // Detail view (expanded transfer)
  const [openId, setOpenId] = useState<string | null>(null);
  const [openLines, setOpenLines] = useState<readonly StockTransferLineDTO[]>([]);

  const reload = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const rows = await stockTransferListRpc({ shopId: SHOP_ID, limit: 100 });
      setTransfers(rows);
    } catch (e) { setErr(`Failed to list transfers: ${String(e)}`); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onCreate = useCallback(async () => {
    if (!toShopId.trim() || !productId.trim() || !batchId.trim()) {
      setToast({ kind: "err", msg: "All fields required: To Shop, Product, Batch, Qty" });
      return;
    }
    const q = Number.parseFloat(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setToast({ kind: "err", msg: "Qty must be > 0" });
      return;
    }
    setBusy(true); setErr(null);
    try {
      const id = `xfer_${Date.now()}`;
      await stockTransferCreateRpc({
        id, fromShopId: SHOP_ID, toShopId: toShopId.trim(),
        createdBy: "user_sourav_owner",
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: [{ productId: productId.trim(), batchId: batchId.trim(), qtyDispatched: q }],
      });
      setShowCreate(false);
      setToShopId(""); setProductId(""); setBatchId(""); setQty(""); setNotes("");
      setToast({ kind: "ok", msg: `Transfer ${id} created (open)` });
      await reload();
    } catch (e) { setToast({ kind: "err", msg: `Create failed: ${String(e)}` }); }
    finally { setBusy(false); }
  }, [toShopId, productId, batchId, qty, notes, reload]);

  const onDispatch = useCallback(async (id: string) => {
    setBusy(true);
    try { await stockTransferDispatchRpc(id); await reload(); setToast({ kind: "ok", msg: `Dispatched ${id}` }); }
    catch (e) { setToast({ kind: "err", msg: `Dispatch failed: ${String(e)}` }); }
    finally { setBusy(false); }
  }, [reload]);

  const onCancel = useCallback(async (id: string) => {
    setBusy(true);
    try { await stockTransferCancelRpc(id); await reload(); setToast({ kind: "ok", msg: `Cancelled ${id}` }); }
    catch (e) { setToast({ kind: "err", msg: `Cancel failed: ${String(e)}` }); }
    finally { setBusy(false); }
  }, [reload]);

  const onOpenDetail = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setOpenLines([]); return; }
    setBusy(true);
    try {
      const lines = await stockTransferListLinesRpc(id);
      setOpenId(id); setOpenLines(lines);
    } catch (e) { setErr(`List lines failed: ${String(e)}`); }
    finally { setBusy(false); }
  }, [openId]);

  const onReceive = useCallback(async (transfer: StockTransferDTO) => {
    if (openLines.length === 0) {
      setToast({ kind: "err", msg: "Open the transfer detail first to load lines" });
      return;
    }
    setBusy(true);
    try {
      await stockTransferReceiveRpc({
        transferId: transfer.id,
        receivedBy: "user_sourav_owner",
        lines: openLines.map((l) => ({
          lineId: l.id,
          qtyReceived: l.qtyDispatched,
        })),
      });
      await reload();
      const refreshed = await stockTransferListLinesRpc(transfer.id);
      setOpenLines(refreshed);
      setToast({ kind: "ok", msg: `Received ${transfer.id} (no variance)` });
    } catch (e) { setToast({ kind: "err", msg: `Receive failed: ${String(e)}` }); }
    finally { setBusy(false); }
  }, [openLines, reload]);

  const summary = useMemo(() => {
    const counts: Record<string, number> = { open: 0, in_transit: 0, received: 0, cancelled: 0 };
    for (const t of transfers) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return counts;
  }, [transfers]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="stock-transfer">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Stock Transfer</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Inter-store moves · in-transit ledger · receive with variance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="neutral">Open · {summary.open ?? 0}</Badge>
          <Badge variant="warning">In transit · {summary.in_transit ?? 0}</Badge>
          <Badge variant="success">Received · {summary.received ?? 0}</Badge>
          <Button onClick={() => setShowCreate(true)} disabled={busy}>
            <Plus size={14} /> New transfer
          </Button>
        </div>
      </header>

      {err && (
        <Glass>
          <div className="flex items-start gap-2 p-3 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        </Glass>
      )}

      {toast && (
        <Glass>
          <div className={`flex items-start gap-2 p-3 text-[13px] ${toast.kind === "ok" ? "text-[var(--pc-state-success)]" : "text-[var(--pc-state-danger)]"}`}>
            {toast.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
            {toast.msg}
          </div>
        </Glass>
      )}

      {showCreate && (
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="stock-transfer-create">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">New transfer from {SHOP_ID}</h2>
              <button onClick={() => setShowCreate(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-[var(--pc-text-secondary)] font-medium">To Shop ID</span>
                <Input value={toShopId} onChange={(e) => setToShopId(e.target.value)} placeholder="shop_branch2" />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-[var(--pc-text-secondary)] font-medium">Qty (units)</span>
                <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min={1} step={1} />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-[var(--pc-text-secondary)] font-medium">Product ID</span>
                <Input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="prod_123" />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-[var(--pc-text-secondary)] font-medium">Batch ID</span>
                <Input value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="batch_a" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] sm:col-span-2">
                <span className="text-[var(--pc-text-secondary)] font-medium">Notes (optional)</span>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="urgent / scheduled / etc." />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void onCreate()} disabled={busy}>
                {busy ? "Creating…" : "Create transfer"}
              </Button>
            </div>
          </div>
        </Glass>
      )}

      <Glass>
        <div className="p-4 flex flex-col gap-2" data-testid="transfer-list">
          {transfers.length === 0 ? (
            <div className="text-[13px] text-[var(--pc-text-tertiary)] py-8 text-center">
              No transfers yet. Click <strong>New transfer</strong> to create one.
            </div>
          ) : (
            <table className="text-[13px] w-full">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">ID</th>
                  <th className="py-2 font-medium">Route</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Created</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => {
                  const isOpen = openId === t.id;
                  return (
                    <>
                      <tr key={t.id} className="border-b border-[var(--pc-border-subtle)] last:border-0 cursor-pointer" onClick={() => void onOpenDetail(t.id)}>
                        <td className="py-2 font-mono text-[11px]">{t.id.slice(0, 16)}…</td>
                        <td className="py-2">
                          <span className="font-mono text-[11px]">{t.fromShopId}</span> <ArrowRight size={10} className="inline" /> <span className="font-mono text-[11px]">{t.toShopId}</span>
                        </td>
                        <td className="py-2">
                          <Badge variant={
                            t.status === "received" ? "success"
                              : t.status === "in_transit" ? "warning"
                              : t.status === "cancelled" ? "danger"
                              : "neutral"
                          }>{t.status.replace("_", " ").toUpperCase()}</Badge>
                        </td>
                        <td className="py-2 text-[var(--pc-text-secondary)]">{new Date(t.createdAt).toLocaleString("en-IN")}</td>
                        <td className="py-2 text-right">
                          <div className="inline-flex gap-1.5 justify-end">
                            {t.status === "open" && <Button variant="secondary" onClick={(e) => { e.stopPropagation(); void onDispatch(t.id); }} disabled={busy}>Dispatch</Button>}
                            {(t.status === "open" || t.status === "in_transit") && <Button variant="ghost" onClick={(e) => { e.stopPropagation(); void onCancel(t.id); }} disabled={busy}>Cancel</Button>}
                            {t.status === "in_transit" && t.toShopId === SHOP_ID && <Button onClick={(e) => { e.stopPropagation(); void onReceive(t); }} disabled={busy}>Receive</Button>}
                          </div>
                        </td>
                      </tr>
                      {isOpen && openLines.length > 0 && (
                        <tr key={`${t.id}-detail`} className="bg-[var(--pc-bg-surface-2)]">
                          <td colSpan={5} className="p-3">
                            <div className="text-[11px] text-[var(--pc-text-tertiary)] uppercase mb-2">Lines ({openLines.length})</div>
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="text-left text-[var(--pc-text-tertiary)]">
                                  <th>Product</th><th>Batch</th><th>Dispatched</th><th>Received</th><th>Variance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {openLines.map((l) => (
                                  <tr key={l.id}>
                                    <td className="font-mono">{l.productId}</td>
                                    <td className="font-mono">{l.batchId}</td>
                                    <td className="font-mono tabular-nums">{l.qtyDispatched}</td>
                                    <td className="font-mono tabular-nums">{l.qtyReceived ?? "—"}</td>
                                    <td className="text-[var(--pc-text-secondary)]">{l.varianceNote ?? ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Glass>
    </div>
  );
}
