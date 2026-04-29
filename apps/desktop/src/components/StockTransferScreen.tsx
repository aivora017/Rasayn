import { useEffect } from "react";
// SCAFFOLD — generated 2026-04-28 from MASTER_PLAN_v3.
// Outbound + inbound stock transfer with batch preservation, in-transit ledger, auto-reconciliation on receive.
// Backing package: @pharmacare/batch-repo
// See SCAFFOLD_INDEX.md for the full feature → file map.

export interface StockTransferScreenProps {
  /** Mode the AppShell passes when navigating to this screen. */
  readonly visible?: boolean;
}

export default function StockTransferScreen({ visible = true }: StockTransferScreenProps) {
  useEffect(() => {
    if (!visible) return;
    // TODO(StockTransferScreen): preload data via @pharmacare/batch-repo
  }, [visible]);

  return (
    <div className="screen-shell" data-screen="stocktransferscreen" data-status="scaffold">
      <header className="screen-header">
        <h1 className="screen-title">Stock Transfer (Inter-Store)</h1>
        <span className="screen-status-pill scaffold">SCAFFOLD</span>
      </header>
      <div className="screen-empty">
        <p className="screen-empty__title">Stock Transfer (Inter-Store) — coming online</p>
        <p className="screen-empty__sub">Outbound + inbound stock transfer with batch preservation, in-transit ledger, auto-reconciliation on receive.</p>
        <p className="screen-empty__hint">Backing package: <code>@pharmacare/batch-repo</code></p>
      </div>
    </div>
  );
}
