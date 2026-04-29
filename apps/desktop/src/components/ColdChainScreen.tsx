import { useEffect } from "react";
// SCAFFOLD — generated 2026-04-28 from MASTER_PLAN_v3.
// Live temperature streams from BLE-paired fridges. Excursion alerts and AEFI pre-fill.
// Backing package: @pharmacare/cold-chain
// See SCAFFOLD_INDEX.md for the full feature → file map.

export interface ColdChainScreenProps {
  /** Mode the AppShell passes when navigating to this screen. */
  readonly visible?: boolean;
}

export default function ColdChainScreen({ visible = true }: ColdChainScreenProps) {
  useEffect(() => {
    if (!visible) return;
    // TODO(ColdChainScreen): preload data via @pharmacare/cold-chain
  }, [visible]);

  return (
    <div className="screen-shell" data-screen="coldchainscreen" data-status="scaffold">
      <header className="screen-header">
        <h1 className="screen-title">Cold-Chain (BLE Sensors)</h1>
        <span className="screen-status-pill scaffold">SCAFFOLD</span>
      </header>
      <div className="screen-empty">
        <p className="screen-empty__title">Cold-Chain (BLE Sensors) — coming online</p>
        <p className="screen-empty__sub">Live temperature streams from BLE-paired fridges. Excursion alerts and AEFI pre-fill.</p>
        <p className="screen-empty__hint">Backing package: <code>@pharmacare/cold-chain</code></p>
      </div>
    </div>
  );
}
