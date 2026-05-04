// MultiStoreScreen — S22a. Cross-shop inventory rollup + per-shop drill-down.
// Backed by shops_list, batches_list_by_shop, shops_inventory_summary
// Tauri commands and migration 0044 (batches.shop_id).

import { useCallback, useEffect, useState } from "react";
import { Boxes, Store, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  shopsListRpc,
  batchesListByShopRpc,
  shopsInventorySummaryRpc,
  type ShopRowDTO,
  type ShopStockRowDTO,
  type ShopSummaryRowDTO,
} from "../lib/ipc.js";

type Toast = { kind: "ok" | "err"; msg: string } | null;

export interface MultiStoreScreenProps { readonly visible?: boolean }

export default function MultiStoreScreen({ visible = true }: MultiStoreScreenProps): React.ReactElement {
  const [shops, setShops] = useState<readonly ShopRowDTO[]>([]);
  const [summary, setSummary] = useState<readonly ShopSummaryRowDTO[]>([]);
  const [selectedShop, setSelectedShop] = useState<string>("");
  const [stock, setStock] = useState<readonly ShopStockRowDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [s, sum] = await Promise.all([shopsListRpc(), shopsInventorySummaryRpc()]);
      setShops(s);
      setSummary(sum);
      if (s.length > 0 && !selectedShop) setSelectedShop(s[0]!.id);
    } catch (e) {
      setToast({ kind: "err", msg: `Reload failed: ${String(e)}` });
    } finally { setBusy(false); }
  }, [selectedShop]);

  useEffect(() => { if (visible) void reload(); }, [visible, reload]);

  const reloadStock = useCallback(async (shopId: string) => {
    if (!shopId) return;
    setBusy(true);
    try {
      const rows = await batchesListByShopRpc({ shopId, limit: 200 });
      setStock(rows);
    } catch (e) { setToast({ kind: "err", msg: String(e) }); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { if (selectedShop) void reloadStock(selectedShop); }, [selectedShop, reloadStock]);

  const totalUnitsAcrossShops = summary.reduce((acc, s) => acc + s.totalUnits, 0);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="multistore">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Boxes size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Multi-Store Inventory</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              {shops.length} {shops.length === 1 ? "shop" : "shops"} · {totalUnitsAcrossShops.toLocaleString("en-IN")} units total · per-shop drill-down
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={reload} disabled={busy}><RefreshCw size={14} /> Refresh</Button>
      </header>

      {toast && (
        <Glass>
          <div className={`flex items-start gap-2 p-3 text-[13px] ${toast.kind === "ok" ? "text-[var(--pc-state-success)]" : "text-[var(--pc-state-danger)]"}`}>
            {toast.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
            {toast.msg}
          </div>
        </Glass>
      )}

      <Glass>
        <div className="p-4" data-testid="multistore-summary">
          <h2 className="font-medium text-[14px] mb-3 flex items-center gap-2"><Store size={14} /> Shops</h2>
          {summary.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              No shops registered. Seed at least one shop in the database.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Shop</th>
                  <th className="py-2 font-medium">Products</th>
                  <th className="py-2 font-medium">Batches</th>
                  <th className="py-2 font-medium">Total units</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.shopId}
                      className={`border-b border-[var(--pc-border-subtle)] last:border-0 ${selectedShop === s.shopId ? "bg-[var(--pc-bg-subtle)]" : ""}`}>
                    <td className="py-2">
                      <span className="font-medium">{s.shopName}</span>
                      <span className="ml-2 text-[var(--pc-text-tertiary)] font-mono text-[11px]">{s.shopId}</span>
                    </td>
                    <td className="py-2">{s.productCount}</td>
                    <td className="py-2">{s.batchCount}</td>
                    <td className="py-2">
                      <Badge variant={s.totalUnits > 0 ? "success" : "neutral"}>{s.totalUnits.toLocaleString("en-IN")}</Badge>
                    </td>
                    <td className="py-2">
                      <Button variant={selectedShop === s.shopId ? "default" : "ghost"} onClick={() => setSelectedShop(s.shopId)}>
                        {selectedShop === s.shopId ? "Selected" : "Drill down"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Glass>

      <Glass>
        <div className="p-4" data-testid="multistore-stock">
          <h2 className="font-medium text-[14px] mb-3">
            Stock at {summary.find((s) => s.shopId === selectedShop)?.shopName ?? selectedShop}
            <span className="ml-2 text-[var(--pc-text-tertiary)] text-[11px]">({stock.length} batches with stock)</span>
          </h2>
          {stock.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              {selectedShop ? "No batches with stock at this shop." : "Select a shop above."}
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Product</th>
                  <th className="py-2 font-medium">Batch</th>
                  <th className="py-2 font-medium">Expiry</th>
                  <th className="py-2 font-medium">On hand</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((b) => (
                  <tr key={b.batchId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2">{b.productName}</td>
                    <td className="py-2 font-mono">{b.batchNo}</td>
                    <td className="py-2 text-[var(--pc-text-secondary)]">{b.expiryDate}</td>
                    <td className="py-2">{b.qtyOnHand.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Glass>
    </div>
  );
}
